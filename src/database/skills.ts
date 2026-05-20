import { getDatabase, isVecAvailable } from "./connection";
import type { Skill, SkillRow } from "./types";
import { upsertEmbedding } from "./search";
import { config } from "../config";

function rowToSkill(row: SkillRow): Skill {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export function upsertSkill(skill: Omit<Skill, "created_at" | "updated_at">): void {
  const db = getDatabase();
  
  db.run(
    `INSERT OR REPLACE INTO skills 
     (id, name, description, directory, tags, repo_owner, repo_name,
      repo_branch, readme_url, content, metadata, source, installs, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    [
      skill.id,
      skill.name,
      skill.description || "",
      skill.directory,
      JSON.stringify(skill.tags || []),
      skill.repo_owner || null,
      skill.repo_name || null,
      skill.repo_branch || "main",
      skill.readme_url || null,
      skill.content || "",
      JSON.stringify(skill.metadata || {}),
      skill.source || "unknown",
      skill.installs || 0,
    ]
  );
}

export function upsertSkillWithEmbedding(
  skill: Omit<Skill, "created_at" | "updated_at">,
  embedding: number[]
): void {
  // Upsert skill
  upsertSkill(skill);
  
  // Upsert embedding
  if (isVecAvailable() && embedding.length === config.embedding.dim) {
    upsertEmbedding(skill.id, embedding);
  }
}

export function getSkill(id: string): Skill | null {
  const db = getDatabase();
  const row = db.query("SELECT rowid, * FROM skills WHERE id = ?").get(id) as SkillRow | undefined;
  return row ? rowToSkill(row) : null;
}

export function getSkillByRowid(rowid: number): Skill | null {
  const db = getDatabase();
  const row = db.query("SELECT rowid, * FROM skills WHERE rowid = ?").get(rowid) as SkillRow | undefined;
  return row ? rowToSkill(row) : null;
}

export function getAllSkills(limit = 100, offset = 0): Skill[] {
  const db = getDatabase();
  const rows = db.query(
    "SELECT rowid, * FROM skills ORDER BY name LIMIT ? OFFSET ?"
  ).all(limit, offset) as SkillRow[];
  return rows.map(rowToSkill);
}

export function deleteSkill(id: string): boolean {
  const db = getDatabase();
  const result = db.run("DELETE FROM skills WHERE id = ?", id);
  return result.changes > 0;
}

export function searchSkillsByTags(tags: string[], limit = 20): Skill[] {
  const db = getDatabase();
  const tagsPattern = tags.map(t => `"${t}"`).join(" OR ");
  const rows = db.query(
    `SELECT rowid, * FROM skills WHERE tags LIKE ? ORDER BY name LIMIT ?`
  ).all(`%${tags[0]}%`, limit) as SkillRow[];
  return rows.map(rowToSkill);
}

export function getSkillCount(): number {
  const db = getDatabase();
  const result = db.query("SELECT COUNT(*) as count FROM skills").get() as { count: number };
  return result.count;
}