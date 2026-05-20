export const config = {
  embedding: {
    provider: process.env.OLLAMA_HOST || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "gemma:300m",
    dim: parseInt(process.env.EMBEDDING_DIM || "768"),
  },
  database: {
    path: process.env.DB_PATH || "./skills.db",
  },
  sqlite: {
    darwin: "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    linux: "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
    win32: null,
  },
  mcp: {
    name: "skills-search-mcp",
    version: "1.0.0",
  },
} as const;