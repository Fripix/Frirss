import type { Request } from 'express';
import { getSetting } from './db.js';

/**
 * OIDC helpers for Authentik (or any OpenID Connect provider).
 *
 * Config is stored in the `settings` table (managed via the admin UI):
 *   oidc_enabled       'true' | 'false'
 *   oidc_issuer        e.g. https://auth.example.com/application/o/frirss/
 *   oidc_client_id
 *   oidc_client_secret
 *   oidc_button_label  e.g. "Authentik"
 *
 * Discovery document is fetched from {issuer}/.well-known/openid-configuration
 * and cached in memory (1h TTL).
 */

export interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  [key: string]: unknown;
}

interface DiscoveryCache {
  issuer: string;
  doc: DiscoveryDoc;
  fetchedAt: number;
}

let discoveryCache: DiscoveryCache | null = null;
const DISCOVERY_TTL = 60 * 60 * 1000; // 1h

export function isOidcEnabled(): boolean {
  return getSetting('oidc_enabled') === 'true' && !!getSetting('oidc_issuer');
}

export interface OidcServerConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  ssoOnly: boolean;
}

export function getOidcConfig(): OidcServerConfig {
  return {
    enabled: isOidcEnabled(),
    issuer: getSetting('oidc_issuer') || '',
    clientId: getSetting('oidc_client_id') || '',
    clientSecret: getSetting('oidc_client_secret') || '',
    buttonLabel: getSetting('oidc_button_label') || 'SSO',
    ssoOnly: getSetting('oidc_sso_only') === 'true',
  };
}

/**
 * Fetch (and cache) the OpenID Connect discovery document.
 */
export async function getDiscovery(): Promise<DiscoveryDoc> {
  const issuer = getSetting('oidc_issuer');
  if (!issuer) throw new Error('OIDC issuer not configured');

  const now = Date.now();
  if (
    discoveryCache &&
    discoveryCache.issuer === issuer &&
    now - discoveryCache.fetchedAt < DISCOVERY_TTL
  ) {
    return discoveryCache.doc;
  }

  const base = issuer.replace(/\/$/, '');
  const url = `${base}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }
  const doc = (await res.json()) as DiscoveryDoc;
  discoveryCache = { issuer, doc, fetchedAt: now };
  return doc;
}

/**
 * Build the redirect URI sent to the OIDC provider.
 * Uses FRIRSS_BASE_URL env if set, otherwise derives from the request.
 */
export function getRedirectUri(req: Request): string {
  const envBase = process.env.FRIRSS_BASE_URL;
  let base: string;
  if (envBase) {
    base = envBase.replace(/\/$/, '');
  } else {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    base = `${proto}://${host}`;
  }
  return `${base}/api/auth/oidc/callback`;
}

/**
 * Reset the discovery cache (e.g. after settings change).
 */
export function clearDiscoveryCache(): void {
  discoveryCache = null;
}
