import { config } from "../config";
import type { EmbeddingResult } from "../database/types";

export interface OllamaEmbeddingResponse {
  model: string;
  embeddings: number[][];
}

export class EmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl || config.embedding.provider;
    this.model = model || config.embedding.model;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      
      if (!data.embeddings || data.embeddings.length === 0) {
        throw new Error("No embeddings returned from Ollama");
      }

      return {
        embedding: data.embeddings[0],
        model: data.model,
        done: true,
      };
    } catch (e) {
      console.error("[embedding] Failed to get embedding:", e);
      throw e;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      return data.embeddings || [];
    } catch (e) {
      console.error("[embedding] Failed to get batch embeddings:", e);
      throw e;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getInfo(): { baseUrl: string; model: string } {
    return { baseUrl: this.baseUrl, model: this.model };
  }
}

// Singleton instance
let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!provider) {
    provider = new EmbeddingProvider();
  }
  return provider;
}