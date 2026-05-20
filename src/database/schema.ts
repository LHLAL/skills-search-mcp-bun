import type { Database } from "bun:sqlite";

export function initializeSchema(db: Database): void {
  // Skills table
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      directory TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      repo_owner TEXT,
      repo_name TEXT,
      repo_branch TEXT DEFAULT 'main',
      readme_url TEXT,
      content TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      source TEXT DEFAULT 'unknown',
      installs INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Create rowid alias for FTS join
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_skills_rowid ON skills(rowid)
  `);

  // FTS5 table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      name,
      description,
      tags,
      content,
      content='skills',
      content_rowid='rowid'
    )
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
      INSERT INTO skills_fts(rowid, name, description, tags, content)
      VALUES (NEW.rowid, NEW.name, NEW.description, NEW.tags, NEW.content);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, name, description, tags, content)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.tags, OLD.content);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
      INSERT INTO skills_fts(skills_fts, rowid, name, description, tags, content)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.description, OLD.tags, OLD.content);
      INSERT INTO skills_fts(rowid, name, description, tags, content)
      VALUES (NEW.rowid, NEW.name, NEW.description, NEW.tags, NEW.content);
    END
  `);

  // Vector table (created separately after extension is loaded)
  try {
    const dim = parseInt(process.env.EMBEDDING_DIM || "768");
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS skills_vec USING vec0(
        embedding float[${dim}]
      )
    `);
  } catch (e) {
    // vec0 might not be available
    console.warn("[db] Could not create skills_vec table:", e);
  }
}