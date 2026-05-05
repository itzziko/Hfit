import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Support for persistent disks (Render / Docker)
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');

const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database
});

export async function initDb() {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT NOT NULL,
      age INTEGER NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_banned INTEGER DEFAULT 0,
      last_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY,
      data_json TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      message TEXT NOT NULL,
      reply TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'ip' or 'email'
      value TEXT UNIQUE NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO stats (key, value) VALUES ('visits', 0);
  `);

  try { await db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch (e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.exec("ALTER TABLE users ADD COLUMN last_ip TEXT"); } catch (e) {}
  try { await db.exec("ALTER TABLE feedback ADD COLUMN reply TEXT"); } catch (e) {}

  // Automatic promotion disabled for security. Use OWNER_KEY to promote via chat.
  console.log('✅ SQLite Database initialized and secured');
  return db;
}

export default dbPromise;
