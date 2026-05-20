import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { config } from "../src/config";

console.log("=== SQLite Extension Support Check ===\n");

// Check custom SQLite
const customSQLite = config.sqlite[process.platform as keyof typeof config.sqlite];
if (customSQLite) {
  if (existsSync(customSQLite)) {
    console.log(`✅ Custom SQLite found: ${customSQLite}`);
  } else {
    console.log(`❌ Custom SQLite not found: ${customSQLite}`);
    console.log(`   Install: brew install sqlite3`);
  }
} else {
  console.log("ℹ️  No custom SQLite configured for this platform");
}

// Check vec extension
const vecPaths = [
  "node_modules/sqlite-vec-darwin-x64/vec0.dylib",
  "node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
  "node_modules/sqlite-vec-linux-x64/vec0.so",
  "node_modules/sqlite-vec-linux-arm64/vec0.so",
  "node_modules/sqlite-vec-win32-x64/vec0.dll",
];

let vecFound = false;
for (const path of vecPaths) {
  if (existsSync(path)) {
    console.log(`✅ sqlite-vec found: ${path}`);
    vecFound = true;
    break;
  }
}

if (!vecFound) {
  console.log("❌ sqlite-vec extension not found");
  console.log("   Install: npm install sqlite-vec");
}

// Try loading extension
console.log("\n=== Testing Extension Loading ===\n");

try {
  // Try custom SQLite
  if (customSQLite && existsSync(customSQLite)) {
    Database.setCustomSQLite(customSQLite);
  }
  
  const db = new Database(":memory:");
  
  // Try loading vec
  for (const path of vecPaths) {
    if (existsSync(path)) {
      try {
        db.loadExtension(path);
        console.log(`✅ vec0 extension loaded successfully`);
        
        // Test vec0 functionality
        db.exec("CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])");
        const testEmbedding = new Float32Array([1.0, 2.0, 3.0]);
        const blob = Buffer.from(testEmbedding.buffer);
        db.run("INSERT INTO test_vec(rowid, embedding) VALUES (1, ?)", [blob]);
        
        const result = db.query("SELECT distance FROM test_vec WHERE embedding = ?").get(blob);
        console.log(`✅ vec0 search working: distance = ${(result as { distance: number }).distance}`);
        
        console.log("\n✅ All checks passed!");
        process.exit(0);
      } catch (e) {
        console.log(`❌ Failed to load vec0: ${e}`);
      }
    }
  }
  
  console.log("⚠️  sqlite-vec not available, vector search will be disabled");
  process.exit(0);
} catch (e) {
  console.log(`❌ Error: ${e}`);
  process.exit(1);
}