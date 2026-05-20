import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const customSQLite = "/usr/local/opt/sqlite/lib/libsqlite3.dylib";
if (existsSync(customSQLite)) {
  Database.setCustomSQLite(customSQLite);
}

// Use cc-switch's actual database
const homeDir = Bun.env.HOME || process.env.HOME || ".";
const dbPath = `${homeDir}/.cc-switch/cc-switch.db`;
const skillsDir = `${homeDir}/.cc-switch/skills`;

console.log("=== Skills Search Demo ===\n");
console.log(`Database: ${dbPath}`);
console.log(`Skills dir: ${skillsDir}\n`);

if (!existsSync(dbPath)) {
  console.log("❌ cc-switch database not found!");
  process.exit(1);
}

const db = new Database(dbPath);
db.loadExtension("node_modules/sqlite-vec-darwin-x64/vec0.dylib");
console.log("✅ Database connected");

// Get all skills
const skills = db.query(`
  SELECT id, name, description, directory 
  FROM skills
`).all() as { id: string; name: string; description: string; directory: string }[];

console.log(`Found ${skills.length} skills in database\n`);

if (skills.length === 0) {
  console.log("❌ No skills found. Please install some skills in CC-Switch first.");
  process.exit(1);
}

// Load skill content from files
interface SkillWithContent {
  id: string;
  name: string;
  description: string;
  content: string;
  directory: string;
}

const skillsWithContent: SkillWithContent[] = skills.map(skill => {
  // Try to read skill content from file
  let content = skill.description || "";
  
  const readmePath = join(skillsDir, skill.directory, "README.md");
  const descriptionPath = join(skillsDir, skill.directory, "DESCRIPTION.md");
  
  if (existsSync(readmePath)) {
    content = readFileSync(readmePath, "utf-8");
  } else if (existsSync(descriptionPath)) {
    content = readFileSync(descriptionPath, "utf-8");
  }
  
  // Truncate long content
  if (content.length > 5000) {
    content = content.slice(0, 5000);
  }
  
  return {
    ...skill,
    content,
  };
});

// Check for vector table
const vecExists = db.query("SELECT name FROM sqlite_master WHERE name='skills_vec'").get();
if (!vecExists) {
  console.log("Creating skills_vec table...");
  db.exec(`CREATE VIRTUAL TABLE skills_vec USING vec0(embedding float[768])`);
}

// Get rowid mapping
const skillsWithRowid: { rowid: number; skill: SkillWithContent }[] = [];
for (const skill of skillsWithContent) {
  const row = db.query("SELECT rowid FROM skills WHERE id = ?").get(skill.id) as { rowid: number } | undefined;
  if (row) {
    skillsWithRowid.push({ rowid: row.rowid, skill });
  }
}

console.log(`Loaded ${skillsWithRowid.length} skills with rowid\n`);

// Simple keyword-based embedding simulation
function createEmbedding(text: string, dim: number): Float32Array {
  const emb = new Float32Array(dim);
  const lower = text.toLowerCase();
  
  // Define keyword patterns for different categories
  const patterns: Record<string, number[]> = {
    // Frontend/UI
    frontend: [0.9, 0.8, 0.7],
    ui: [0.85, 0.75, 0.65],
    component: [0.8, 0.7, 0.6],
    react: [0.9, 0.8, 0.6],
    vue: [0.88, 0.78, 0.58],
    html: [0.7, 0.6, 0.5],
    css: [0.65, 0.55, 0.45],
    
    // Backend/API
    api: [0.85, 0.75, 0.65],
    server: [0.8, 0.7, 0.6],
    backend: [0.9, 0.8, 0.7],
    rest: [0.75, 0.65, 0.55],
    database: [0.85, 0.75, 0.65],
    sql: [0.8, 0.7, 0.6],
    
    // DevOps/Cloud
    docker: [0.9, 0.8, 0.7],
    deploy: [0.85, 0.75, 0.65],
    cloud: [0.8, 0.7, 0.6],
    kubernetes: [0.88, 0.78, 0.68],
    
    // AI/ML
    ai: [0.9, 0.8, 0.7],
    ml: [0.88, 0.78, 0.68],
    embedding: [0.95, 0.85, 0.75],
    model: [0.85, 0.75, 0.65],
    gpt: [0.8, 0.7, 0.6],
    
    // Tools/Automation
    automation: [0.9, 0.8, 0.7],
    browser: [0.85, 0.75, 0.65],
    scraping: [0.88, 0.78, 0.68],
    search: [0.85, 0.75, 0.65],
    
    // Productivity
    slides: [0.9, 0.8, 0.7],
    presentation: [0.85, 0.75, 0.65],
    writing: [0.8, 0.7, 0.6],
    research: [0.85, 0.75, 0.65],
    content: [0.75, 0.65, 0.55],
  };
  
  // Apply patterns based on keywords
  let idx = 0;
  for (const [keyword, values] of Object.entries(patterns)) {
    if (lower.includes(keyword)) {
      for (const v of values) {
        emb[idx % dim] = Math.max(emb[idx % dim], v);
        idx++;
      }
    }
  }
  
  // Fill remaining with content hash
  for (let j = 0; j < dim; j++) {
    if (emb[j] === 0) {
      emb[j] = Math.sin(text.charCodeAt(j % text.length)) * 0.05;
    }
  }
  
  return emb;
}

// Insert embeddings (re-insert all skills)
console.log("Generating embeddings...\n");

// Clear existing vectors
try {
  db.run("DELETE FROM skills_vec");
} catch {}

for (const { rowid, skill } of skillsWithRowid) {
  const emb = createEmbedding(skill.content || skill.description, 768);
  db.run("INSERT INTO skills_vec(rowid, embedding) VALUES (?, ?)", [rowid, Buffer.from(emb.buffer)]);
}

console.log("✅ Embeddings inserted\n");

// Now test search
const query = "presentation slides html";
console.log(`🔍 Searching for: "${query}"\n`);

const queryEmb = createEmbedding(query, 768);
const queryBlob = Buffer.from(queryEmb.buffer);

// Vector search
console.log("=== Vector Search Results ===");
const vectorResults = db.query(`
  SELECT s.id, s.name, s.description, 
         vec_distance_cosine(?, v.embedding) as distance
  FROM skills_vec v
  JOIN skills s ON s.rowid = v.rowid
  ORDER BY distance
  LIMIT 5
`).all(queryBlob) as any[];

for (const r of vectorResults) {
  console.log(`  ${r.name} (distance: ${r.distance?.toFixed(4)})`);
  console.log(`    ${r.description?.slice(0, 80)}...`);
}

// Also show all skills for reference
console.log("\n=== All Skills ===");
for (const s of skillsWithContent) {
  console.log(`  - ${s.name}`);
  console.log(`    ${s.description?.slice(0, 60)}...`);
}

console.log("\n✅ Demo complete!");