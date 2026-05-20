export interface Skill {
  id: string;
  name: string;
  description: string;
  directory: string;
  tags: string[];
  repo_owner?: string;
  repo_name?: string;
  repo_branch: string;
  readme_url?: string;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  installs: number;
  created_at: number;
  updated_at: number;
  // SQLite rowid (internal)
  rowid?: number;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  directory: string;
  tags: string;  // JSON string
  repo_owner: string | null;
  repo_name: string | null;
  repo_branch: string;
  readme_url: string | null;
  content: string;
  metadata: string;  // JSON string
  source: string;
  installs: number;
  created_at: number;
  updated_at: number;
  rowid: number;
}

export interface VectorSearchResult extends Skill {
  distance: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  done: boolean;
}