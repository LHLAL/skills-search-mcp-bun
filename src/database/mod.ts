import { existsSync } from "fs";
import { config } from "../config";

// Paths
const HOME = process.env.HOME || "/Users/apple";
const CCSWITCH_DB = `${HOME}/.cc-switch/cc-switch.db`;

let db: any = null;
let _vecAvailable = false;

function getVecExtensionPath(): string | null {
  const paths = [
    "node_modules/sqlite-vec-darwin-x64/vec0.dylib",
    "/Users/apple/Downloads/vscode_space/agent-switch/cc-switch/skills-search-mcp-bun/node_modules/sqlite-vec-darwin-x64/vec0.dylib",
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function isVecAvailable(): boolean {
  return _vecAvailable;
}

export function getDatabase(): any {
  if (db) return db;
  
  const { Database } = require("bun:sqlite");
  
  // Use cc-switch database
  if (!existsSync(CCSWITCH_DB)) {
    throw new Error(`cc-switch database not found: ${CCSWITCH_DB}`);
  }
  
  db = new Database(CCSWITCH_DB);
  console.error(`[db] Connected to cc-switch: ${CCSWITCH_DB}`);
  
  // Try to load vec extension
  const vecPath = getVecExtensionPath();
  if (vecPath) {
    try {
      db.loadExtension(vecPath);
      _vecAvailable = true;
      console.error(`[db] sqlite-vec loaded`);
    } catch (e) {
      console.error("[db] vec not loaded:", e.message);
      _vecAvailable = false;
    }
  }
  
  return db;
}

export function ensureInitialized(): void {
  getDatabase();
}