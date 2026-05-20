import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, handleTool } from "./tools";
import { ensureInitialized } from "./database/mod";

const server = new Server(
  {
    name: "skills-search-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize request handler
server.setRequestHandler(InitializeRequestSchema, async () => {
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "skills-search-mcp", version: "1.0.0" },
  };
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const result = await handleTool(name, args || {});
    return result;
  } catch (e: any) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
      isError: true,
    };
  }
});

async function main() {
  // Initialize database
  ensureInitialized();
  console.error("[mcp] Starting skills-search-mcp v1.0.0");
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Server connected");
}

main().catch((e) => {
  console.error("[mcp] Fatal error:", e);
  process.exit(1);
});