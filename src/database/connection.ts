import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { config } from "../config";
import { initializeSchema } from "./schema";

// SQLite extension paths for different platforms
const VEC_EXTENSION_PATHS = {
  darwin: {
    x64: "node_modules/sqlite-vec-darwin-x64/vec0.dylib",
    arm64: "node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
  },
  linux: {
    x64: "node_modules/sqlite-vec-linux-x64/vec0.so",
    arm64: "node_modules/sqlite-vec-linux-arm64/vec0.so",
  },
  win32: {
    x64: "node_modules/sqlite-vec-win32-x64/vec0.dll",
  },
} as const;

let db: Database | null = null;
let _vecAvailable = false;

function getPlatformKey(): keyof typeof VEC_EXTENSION_PATHS {
  const platform = process.platform;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function getArchKey(): "x64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function getVecExtensionPath(): string | null {
  const platform = getPlatformKey();
  const arch = getArchKey();
  
  const pathTemplate = VEC_EXTENSION_PATHS[platform]?.[arch];
  if (!pathTemplate) return null;
  
  const fullPath = join(process.cwd(), pathTemplate);
  return existsSync(fullPath) ? fullPath : null;
}

function getCustomSQLitePath(): string | null {
  const platform = getPlatformKey();
  const sqlitePath = config.sqlite[platform];
  return sqlitePath && existsSync(sqlitePath) ? sqlitePath : null;
}

export function isVecAvailable(): boolean {
  return _vecAvailable;
}

export function loadVecExtension(db: Database): void {
  const vecPath = getVecExtensionPath();
  
  if (!vecPath) {
    console.warn("[db] sqlite-vec extension not found, vector search disabled");
    console.warn("[db] Install: npm install sqlite-vec");
    _vecAvailable = false;
    return;
  }
  
  try {
    db.loadExtension(vecPath);
    _vecAvailable = true;
    console.log(`[db] sqlite-vec loaded from: ${vecPath}`);
  } catch (e) {
    console.error("[db] Failed to load sqlite-vec:", e);
    _vecAvailable = false;
  }
}

export function getDatabase(): Database {
  if (db) return db;
  
  // Try to use custom SQLite with extension support
  const customSQLite = getCustomSQLitePath();
  if (customSQLite) {
    try {
      Database.setCustomSQLite(customSQLite);
      console.log(`[db] Using custom SQLite: ${customSQLite}`);
    } catch (e) {
      // setCustomSQLite might not be available or fail silently
      console.log("[db] Using default SQLite (setCustomSQLite not available)");
    }
  } else if (process.platform === "darwin") {
    console.warn("[db] Homebrew SQLite not found. Install with: brew install sqlite3");
  }
  
  db = new Database(config.database.path);
  
  // Load vec extension after database creation
  if (vecPath) {
    try {
      db.loadExtension(vecPath);
      _vecAvailable = true;
      console.log(`[db] sqlite-vec loaded from: ${vecPath}`);
    } catch (e) {
      console.warn("[db] Failed to load sqlite-vec:", e);
      _vecAvailable = false;
    }
  }
  
  return db;
}

export function initializeDatabase(): void {
  const db = getDatabase();
  initializeSchema(db);
  console.log("[db] Database initialized");
}