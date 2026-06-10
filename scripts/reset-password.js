#!/usr/bin/env node
/**
 * Réinitialise le mot de passe d'un utilisateur local FriRSS.
 *
 * Le mot de passe est saisi au clavier (entrée masquée), haché en bcrypt
 * (mêmes 12 rounds que le backend), puis écrit dans data/frirss.db.
 * Il n'est jamais passé en argument de ligne de commande ni journalisé.
 *
 * Usage :  node scripts/reset-password.js [username]
 *          (username par défaut : premier admin local)
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FRIRSS_DATA_DIR || path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'frirss.db');
const SALT_ROUNDS = 12;

function prompt(question, { mute = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (mute) {
      // Masque la saisie (affiche * au lieu des caractères)
      const onData = () => {
        const len = rl.line.length;
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question + '*'.repeat(len));
      };
      process.stdin.on('data', onData);
      rl.question(question, (answer) => {
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const db = new Database(dbPath, { fileMustExist: true });

  let username = process.argv[2];
  if (!username) {
    const row = db
      .prepare(`SELECT username FROM users WHERE auth_provider = 'local' ORDER BY id LIMIT 1`)
      .get();
    username = row?.username;
  }
  if (!username) {
    console.error('Aucun utilisateur local trouvé.');
    process.exit(1);
  }

  const user = db
    .prepare(`SELECT id, username FROM users WHERE username = ? AND auth_provider = 'local'`)
    .get(username);
  if (!user) {
    console.error(`Utilisateur local introuvable : ${username}`);
    process.exit(1);
  }

  console.log(`Réinitialisation du mot de passe pour : ${user.username}\n`);

  const pw1 = await prompt('Nouveau mot de passe : ', { mute: true });
  if (!pw1 || pw1.length < 6) {
    console.error('Le mot de passe doit faire au moins 6 caractères.');
    process.exit(1);
  }
  const pw2 = await prompt('Confirmer le mot de passe : ', { mute: true });
  if (pw1 !== pw2) {
    console.error('Les mots de passe ne correspondent pas.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(pw1, SALT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  // Invalide les sessions existantes par sécurité
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  console.log(`\n✅ Mot de passe mis à jour pour « ${user.username} ». Tu peux te connecter.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
