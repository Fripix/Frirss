#!/usr/bin/env node
/**
 * Sauvegarde cohérente de la base SQLite FriRSS.
 *
 * Utilise l'API .backup() de SQLite (snapshot atomique, sûr même en WAL et
 * pendant que le serveur tourne) — contrairement à une simple copie du fichier.
 *
 * Usage :
 *   node scripts/backup-db.js [dossier_destination]
 *   (défaut : ./backups). Variable FRIRSS_DATA_DIR respectée pour la source.
 *
 * Le fichier produit est horodaté : frirss-YYYYMMDD-HHMMSS.db
 */
import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FRIRSS_DATA_DIR || path.join(__dirname, '..', 'data');
const srcPath = path.join(DATA_DIR, 'frirss.db');
const destDir = process.argv[2] || path.join(__dirname, '..', 'backups');

mkdirSync(destDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD-HHMMSS-ish
const ts = `${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`;
const destPath = path.join(destDir, `frirss-${ts}.db`);

const db = new Database(srcPath, { fileMustExist: true, readonly: true });

db.backup(destPath)
  .then(() => {
    console.log(`✅ Sauvegarde créée : ${destPath}`);
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Erreur de sauvegarde :', err.message);
    process.exit(1);
  });
