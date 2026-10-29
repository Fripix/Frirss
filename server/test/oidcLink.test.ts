import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

// Un fournisseur SSO simulé : la découverte et les deux appels du retour
// (échange du code, profil). `nextUserinfo` dit qui revient de chez lui.
let nextUserinfo: Record<string, unknown> = {};
vi.mock('../oidc.js', async () => {
  const actual = await vi.importActual<typeof import('../oidc.js')>('../oidc.js');
  return {
    ...actual,
    getDiscovery: vi.fn(async () => ({
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      userinfo_endpoint: 'https://idp.example.com/userinfo',
    })),
    oidcFetch: vi.fn(async (url: string) => (url.endsWith('/token')
      ? new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      : new Response(JSON.stringify(nextUserinfo), { status: 200 }))),
  };
});

import app from '../index.js';
import db, { setSetting } from '../db.js';

/*
 * Rattacher une identité SSO à un compte FriRSS existant (1.8.0).
 *
 * Avant, la première connexion SSO se rattachait d'office au compte local qui
 * portait la même adresse e-mail — sans exiger qu'elle soit vérifiée : un
 * utilisateur du fournisseur qui inscrivait l'adresse de l'admin dans son
 * profil recevait une session admin. Le rattachement se fait désormais
 * seulement depuis le compte, connecté (Préférences › Général › Compte) :
 * il prouve qu'on tient les deux à la fois.
 *
 * Seconde relecture : (1) une session volée suffisait à rattacher l'identité
 * de l'attaquant, qui survivait au changement de mot de passe — le mot de
 * passe actuel est exigé ; (2) le retour du fournisseur rattachait sur la foi
 * des seuls cookies, qu'un site voisin du même domaine peut déposer — il ne
 * remet plus qu’un ticket, que seule une session du compte qui a lancé la liaison valide ;
 * (3) aucun moyen de délier, rien de visible pour l'admin.
 */
let ownerToken = '';
let ownerId = 0;
let bobId = 0;
let bobToken = '';

const cookiesOf = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => c.split(';')[0]).join('; ');
const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';

/** Lance le rattachement pour `token`, revient du fournisseur avec `userinfo`, rend le ticket. */
async function ticketFor(token: string, userinfo: Record<string, unknown>) {
  const start = await request(app).post('/api/auth/oidc/link').set('Authorization', `Bearer ${token}`)
    .send({ password: 'secret123' });
  expect(start.status).toBe(200);
  nextUserinfo = userinfo;
  const back = await request(app).get(`/api/auth/oidc/callback?code=c&state=${encodeURIComponent(stateOf(start.body.url))}`)
    .set('Cookie', cookiesOf(start));
  return { back, ticket: decodeURIComponent(String(back.headers.location).split('oidc_link_ticket=')[1] ?? '') };
}
const complete = (token: string, ticket: string) =>
  request(app).post('/api/auth/oidc/link/complete').set('Authorization', `Bearer ${token}`).send({ ticket });
/** Le parcours entier : lancer, revenir, valider depuis la même session. */
async function link(token: string, userinfo: Record<string, unknown>) {
  const { back, ticket } = await ticketFor(token, userinfo);
  return ticket ? complete(token, ticket) : back;
}

/** Une connexion SSO ordinaire, qui revient avec `userinfo`. */
async function ssoLogin(userinfo: Record<string, unknown>) {
  const start = await request(app).get('/api/auth/oidc/login');
  nextUserinfo = userinfo;
  return request(app).get(`/api/auth/oidc/callback?code=c&state=${encodeURIComponent(stateOf(start.headers.location))}`)
    .set('Cookie', cookiesOf(start));
}

const subOf = (id: number) => (db.prepare('SELECT oidc_sub FROM users WHERE id = ?').get(id) as { oidc_sub: string | null }).oidc_sub;

beforeAll(async () => {
  setSetting('oidc_enabled', 'true');
  setSetting('oidc_issuer', 'https://idp.example.com/');
  setSetting('oidc_client_id', 'frirss');
  setSetting('oidc_client_secret', 'secret');
  const owner = await request(app).post('/api/auth/register')
    .send({ username: 'owner', password: 'secret123', email: 'owner@example.com' });
  ownerToken = owner.body.token;
  ownerId = owner.body.user.id;
  const bob = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${ownerToken}`)
    .send({ username: 'bob', password: 'secret123', email: 'bob@example.com', role: 'user' });
  bobId = bob.body.user.id;
  bobToken = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' })).body.token;
});

describe('rattacher une identité SSO depuis son compte', () => {
  it('refuse sans session', async () => {
    expect((await request(app).post('/api/auth/oidc/link')).status).toBe(401);
  });

  it('plus de rattachement d’office par l’adresse e-mail : la connexion SSO le demande', async () => {
    // L'adresse de l'admin, qu'aucun fournisseur n'a vérifiée ici.
    const res = await ssoLogin({ sub: 'sub-intrus', email: 'OWNER@example.com' });
    expect(res.headers.location).toBe('/#oidc_error=link_required');
    expect(subOf(ownerId)).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM users WHERE oidc_sub = 'sub-intrus'").get() as { n: number }).n).toBe(0);
  });

  it('exige le mot de passe actuel pour lancer le rattachement', async () => {
    const none = await request(app).post('/api/auth/oidc/link').set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(none.status).toBe(400);
    const wrong = await request(app).post('/api/auth/oidc/link').set('Authorization', `Bearer ${ownerToken}`)
      .send({ password: 'pas-le-bon' });
    expect(wrong.status).toBe(401);
  });

  // Cookie déposé par un site voisin : l'attaquant lance SA liaison, la
  // victime revient du fournisseur avec SON identité dans le navigateur où
  // l'attaquant a posé ses cookies. Le retour ne rattache plus rien : il remet
  // un ticket, qu'une autre session que celle de l'attaquant ne valide pas.
  it('le retour du fournisseur ne rattache rien à lui seul', async () => {
    const { back, ticket } = await ticketFor(bobToken, { sub: 'sub-victime' });
    expect(String(back.headers.location)).toMatch(/^\/#oidc_link_ticket=/);
    expect(subOf(bobId)).toBeNull();
    const elsewhere = await complete(ownerToken, ticket);
    expect(elsewhere.status).toBe(403);
    expect(subOf(bobId)).toBeNull();
    expect(subOf(ownerId)).toBeNull();
  });

  it('refuse un ticket forgé', async () => {
    expect((await complete(bobToken, 'nimporte.quoi.ici')).status).toBe(400);
  });

  it('rattache l’identité au compte connecté, admin compris, sans ouvrir de session', async () => {
    const res = await link(ownerToken, { sub: 'sub-owner', email: 'autre@example.com' });
    expect(res.status).toBe(200);
    expect(subOf(ownerId)).toBe('sub-owner');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(me.body.user.sso_linked).toBe(true);
  });

  it('la connexion SSO ouvre ensuite ce compte-là', async () => {
    const res = await ssoLogin({ sub: 'sub-owner' });
    const token = decodeURIComponent(String(res.headers.location).split('oidc_token=')[1] ?? '');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.id).toBe(ownerId);
  });

  it('refuse un compte déjà rattaché', async () => {
    const res = await request(app).post('/api/auth/oidc/link').set('Authorization', `Bearer ${ownerToken}`)
      .send({ password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('refuse une identité déjà rattachée à un autre compte', async () => {
    const res = await link(bobToken, { sub: 'sub-owner' });
    expect(res.headers.location).toBe('/#oidc_link_error=already_linked');
    expect(subOf(bobId)).toBeNull();
  });

  it('montre à l’admin quels comptes sont liés', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${ownerToken}`);
    const byName = Object.fromEntries(res.body.users.map((u: { username: string; sso_linked: unknown }) => [u.username, u.sso_linked]));
    expect(byName.owner).toBe(true);
    expect(byName.bob).toBe(false);
  });

  it('le dit à la connexion et à /me pour un compte non rattaché', async () => {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bobToken}`);
    expect(me.body.user.sso_linked).toBe(false);
    const login = await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' });
    expect(login.body.user.sso_linked).toBe(false);
  });

  it('une nouvelle identité sans compte correspondant crée toujours son compte', async () => {
    const res = await ssoLogin({ sub: 'sub-new', email: 'new@example.com', preferred_username: 'newbie' });
    expect(String(res.headers.location)).toMatch(/^\/#oidc_token=/);
  });

  it('le titulaire délie son compte, qui ne s’ouvre plus par cette identité', async () => {
    await link(bobToken, { sub: 'sub-bob' });
    expect(subOf(bobId)).toBe('sub-bob');
    const res = await request(app).delete('/api/auth/oidc/link').set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
    expect(subOf(bobId)).toBeNull();
    const back = await ssoLogin({ sub: 'sub-bob', email: 'bob@example.com' });
    expect(back.headers.location).toBe('/#oidc_error=link_required');
  });

  it('l’admin délie un compte local, pas un compte qui n’a que le SSO', async () => {
    await link(bobToken, { sub: 'sub-bob-2' });
    const res = await request(app).delete(`/api/admin/users/${bobId}/sso`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(subOf(bobId)).toBeNull();
    const ssoOnly = db.prepare("SELECT id FROM users WHERE oidc_sub = 'sub-new'").get() as { id: number };
    const refused = await request(app).delete(`/api/admin/users/${ssoOnly.id}/sso`).set('Authorization', `Bearer ${ownerToken}`);
    expect(refused.status).toBe(400);
    // Délier ferme les sessions du compte (voir plus bas) : Bob se reconnecte.
    bobToken = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' })).body.token;
  });

  it('un non-admin ne délie pas le compte d’un autre', async () => {
    const res = await request(app).delete(`/api/admin/users/${ownerId}/sso`).set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });

  // Une identité rattachée à tort (en 1.7.x, par l'adresse e-mail) a pu
  // ouvrir des sessions : délier doit les fermer, comme un changement de mot
  // de passe ferme les autres sessions.
  const tokenOf = (res: request.Response) => decodeURIComponent(String(res.headers.location).split('oidc_token=')[1] ?? '');
  const meStatus = async (token: string) => (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status;

  it('délier son compte ferme les sessions ouvertes par le SSO, pas la sienne', async () => {
    await link(bobToken, { sub: 'sub-bob-3' });
    const ssoSession = tokenOf(await ssoLogin({ sub: 'sub-bob-3' }));
    expect(await meStatus(ssoSession)).toBe(200);
    expect((await request(app).delete('/api/auth/oidc/link').set('Authorization', `Bearer ${bobToken}`)).status).toBe(200);
    expect(await meStatus(ssoSession)).toBe(401);
    expect(await meStatus(bobToken)).toBe(200);
  });

  it('l’admin qui délie un compte en ferme toutes les sessions', async () => {
    await link(bobToken, { sub: 'sub-bob-4' });
    const ssoSession = tokenOf(await ssoLogin({ sub: 'sub-bob-4' }));
    expect((await request(app).delete(`/api/admin/users/${bobId}/sso`).set('Authorization', `Bearer ${ownerToken}`)).status).toBe(200);
    expect(await meStatus(ssoSession)).toBe(401);
    expect(await meStatus(bobToken)).toBe(401);
    expect(await meStatus(ownerToken)).toBe(200);
    bobToken = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' })).body.token;
  });
});

