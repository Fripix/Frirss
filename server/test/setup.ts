import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Isolate tests from the real database: each run gets a fresh temp data dir.
// Must be set BEFORE any module imports server/db.js.
process.env.NODE_ENV = 'test';
process.env.FRIRSS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'frirss-test-'));
