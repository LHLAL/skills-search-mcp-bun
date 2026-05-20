import { test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { config } from "../src/config";

// Set custom SQLite once for all tests
beforeAll(() => {
  const customSQLite = config.sqlite.darwin;
  if (customSQLite && existsSync(customSQLite)) {
    Database.setCustomSQLite(customSQLite);
  }
});

test("Homebrew SQLite with extension support", () => {
  const vecPath = "node_modules/sqlite-vec-darwin-x64/vec0.dylib";
  expect(existsSync(vecPath)).toBe(true);
});

test("vec0 table creation", () => {
  const db = new Database(":memory:");
  db.loadExtension("node_modules/sqlite-vec-darwin-x64/vec0.dylib");
  
  db.exec(`CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])`);
  
  const tables = db.query(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as { name: string }[];
  
  expect(tables.map(t => t.name)).toContain("test_vec");
});

test("embedding insert and search", () => {
  const db = new Database(":memory:");
  db.loadExtension("node_modules/sqlite-vec-darwin-x64/vec0.dylib");
  
  db.exec(`CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])`);
  
  const emb1 = new Float32Array([1.0, 2.0, 3.0]);
  const emb2 = new Float32Array([4.0, 5.0, 6.0]);
  
  db.run("INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)", [1, Buffer.from(emb1.buffer)]);
  db.run("INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)", [2, Buffer.from(emb2.buffer)]);
  
  const results = db.query("SELECT rowid FROM test_vec").all() as { rowid: number }[];
  expect(results.length).toBe(2);
});