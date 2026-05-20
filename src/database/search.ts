import { getDatabase, isVecAvailable } from "./connection";
import { getSkillByRowid } from "./skills";
import type { Skill, SkillRow, VectorSearchResult } from "./types";
import { config } from "../config";

const EMBEDDING_DIM = config.embedding.dim;

export function upsertEmbedding(skillId: string, embedding: number[]): void {
  if (!isVecAvailable()) {
    console.warn("[search] Vector search not available");
    return;
  }

  const db = getDatabase();
  
  // Get rowid for the skill
  const row = db.query("SELECT rowid FROM skills WHERE id = ?").get(skillId) as { rowid: number } | undefined;
  if (!row) {
    console.warn(`[search] Skill not found: ${skillId}`);
    return;
  }

  // Convert embedding to binary (Float32Array)
  const embArray = new Float32Array(embedding);
  const embBlob = Buffer.from(embArray.buffer);

  try {
    db.run(
      "INSERT OR REPLACE INTO skills_vec(rowid, embedding) VALUES (?, ?)",
      [row.rowid, embBlob]
    );
  } catch (e) {
    console.error("[search] Failed to upsert embedding:", e);
  }
}

export function searchVector(
  embedding: number[],
  limit = 20
): VectorSearchResult[] {
  if (!isVecAvailable()) {
    console.warn("[search] Vector search not available");
    return [];
  }

  const db = getDatabase();
  
  const embBlob = Buffer.from(new Float32Array(embedding).buffer);

  try {
    // sqlite-vec search using vec_distance_cosine
    const rows = db.query(`
      SELECT s.rowid, s.id, s.name, s.description, s.tags, s.directory, s.source,
             vec_distance_cosine(?, v.embedding) as distance
      FROM skills_vec v
      JOIN skills s ON s.rowid = v.rowid
      ORDER BY distance
      LIMIT ?
    `).all(embBlob, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tags: JSON.parse(row.tags || "[]"),
      directory: row.directory,
      source: row.source,
      distance: row.distance,
      rowid: row.rowid,
    }));
  } catch (e) {
    console.error("[search] Vector search failed:", e);
    return [];
  }
}

export function searchBM25(query: string, limit = 20): Skill[] {
  const db = getDatabase();

  if (!query.trim()) return [];

  try {
    // Escape special FTS5 characters and prepare query
    const ftsQuery = query
      .replace(/"/g, '""')
      .replace(/\*/g, ' ')
      .trim();

    const rows = db.query(`
      SELECT s.rowid, s.*
      FROM skills_fts f
      JOIN skills s ON s.rowid = f.rowid
      WHERE skills_fts MATCH ?1
      ORDER BY rank
      LIMIT ?2
    `).all(ftsQuery, limit) as SkillRow[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
    }));
  } catch (e) {
    // FTS might not be available
    console.warn("[search] BM25 search failed:", e);
    return [];
  }
}

export function searchHybrid(
  query: string,
  embedding: number[],
  limit = 20,
  vectorWeight = 0.7,
  bm25Weight = 0.3
): Skill[] {
  const vectorResults = searchVector(embedding, limit * 2);
  const bm25Results = searchBM25(query, limit * 2);

  if (vectorResults.length === 0) return bm25Results;
  if (bm25Results.length === 0) return vectorResults;

  // Create score map
  const scores = new Map<string, { skill: Skill; score: number }>();

  // Score vector results
  for (const result of vectorResults) {
    const maxDist = 1.0; // Normalize distance to score
    const score = (1 - result.distance / maxDist) * vectorWeight;
    scores.set(result.id, { skill: result, score });
  }

  // Add BM25 scores
  const maxRank = bm25Results.length;
  bm25Results.forEach((skill, index) => {
    const rankScore = (1 - index / maxRank) * bm25Weight;
    const existing = scores.get(skill.id);
    if (existing) {
      existing.score += rankScore;
    } else {
      scores.set(skill.id, { skill, score: rankScore });
    }
  });

  // Sort by combined score and return top results
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.skill);
}

export function isVecTableEmpty(): boolean {
  const db = getDatabase();
  try {
    const result = db.query("SELECT COUNT(*) as count FROM skills_vec").get() as { count: number };
    return result.count === 0;
  } catch {
    return true;
  }
}

export function getVectorCount(): number {
  const db = getDatabase();
  try {
    const result = db.query("SELECT COUNT(*) as count FROM skills_vec").get() as { count: number };
    return result.count;
  } catch {
    return 0;
  }
}