import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// 只有一个检索接口
export const tools: Tool[] = [
  {
    name: "search_skills",
    description: "Search skills from cc-switch database using text similarity",
    inputSchema: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "Search query" 
        },
        limit: { 
          type: "number", 
          description: "Max results (default 8)",
          default: 8
        },
      },
      required: ["query"],
    },
  },
];

export async function handleTool(name: string, args: any): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const errorMsg = "Only search_skills tool is available";
  
  if (name !== "search_skills") {
    return { 
      content: [{ type: "text", text: JSON.stringify({ error: errorMsg }) }], 
      isError: true 
    };
  }

  const query = args.query as string;
  const limit = (args.limit as number) || 8;
  const db = require("../database/mod").getDatabase();
  
  try {
    const rows = db.query(`
      SELECT id, name, description, directory, repo_owner, repo_name, 
             repo_branch, readme_url, source, installs
      FROM skills 
      WHERE name LIKE ?1 OR description LIKE ?1
      ORDER BY installs DESC
      LIMIT ?2
    `).all("%" + query + "%", limit);
    
    const results = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || "",
      directory: row.directory,
      source: row.source || "unknown",
      installs: row.installs || 0,
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          query,
          count: results.length,
          results
        }, null, 2)
      }]
    };
  } catch (e: any) {
    return { 
      content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], 
      isError: true 
    };
  }
}
