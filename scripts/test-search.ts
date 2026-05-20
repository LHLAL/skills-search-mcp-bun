import { Database } from "bun:sqlite";
import { config } from "../src/config";
import { existsSync } from "fs";

console.log("=== Full Integration Test ===\n");

// Use custom SQLite
const customSQLite = config.sqlite.darwin;
if (customSQLite && existsSync(customSQLite)) {
  Database.setCustomSQLite(customSQLite);
  console.log(`Using custom SQLite: ${customSQLite}`);
}

const db = new Database(":memory:");
const vecPath = "node_modules/sqlite-vec-darwin-x64/vec0.dylib";

// Load extension
db.loadExtension(vecPath);
console.log("✅ vec0 extension loaded\n");

const DIM = 768;

// Create test table
db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT,
    name TEXT,
    rowid INTEGER PRIMARY KEY
  )
`);

db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS skills_vec USING vec0(embedding float[${DIM}])`);
console.log("✅ Tables created\n");

// Insert test data
const embeddings = [
  { id: "1", name: "Python Skill", emb: new Float32Array(Array(DIM).fill(0.1)) },
  { id: "2", name: "JavaScript Skill", emb: new Float32Array(Array(DIM).fill(0.2)) },
  { id: "3", name: "Rust Skill", emb: new Float32Array(Array(DIM).fill(0.3)) },
];

db.run("INSERT INTO skills (id, name) VALUES (?, ?)", ["1", "Python Skill"]);
db.run("INSERT INTO skills (id, name) VALUES (?, ?)", ["2", "JavaScript Skill"]);
db.run("INSERT INTO skills (id, name) VALUES (?, ?)", ["3", "Rust Skill"]);
console.log("✅ Skills inserted\n");

// Insert embeddings
for (const item of embeddings) {
  const blob = Buffer.from(item.emb.buffer);
  const row = db.query("SELECT rowid FROM skills WHERE id = ?").get(item.id) as { rowid: number };
  db.run("INSERT INTO skills_vec(rowid, embedding) VALUES (?, ?)", [row.rowid, blob]);
}
console.log("✅ Embeddings inserted\n");

// Search
const searchEmb = new Float32Array(Array(DIM).fill(0.1));
const searchBlob = Buffer.from(searchEmb.buffer);

console.log("Searching for similar embedding...\n");
const results = db.query(`
  SELECT s.id, s.name, v.distance
  FROM skills_vec v
  JOIN skills s ON s.rowid = v.rowid
  WHERE v.embedding = ?
  ORDER BY v.distance
  LIMIT 5
`).all(searchBlob) as { id: string; name: string; distance: number | null }[];

console.log("Results:");
for (const r of results) {
  console.log(`  ${r.name}: distance=${r.distance}`);
}

console.log("\n✅ Search complete!");
console.log("\nSummary: Bun + Homebrew SQLite + sqlite-vec is working!");