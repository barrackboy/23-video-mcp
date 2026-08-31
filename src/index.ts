import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTwentyThreeServer, assertEnv } from "./server.js";

// Local/desktop entry point (e.g. Claude Desktop config) using stdio transport.
// For HTTP hosting (e.g. on Vercel), see api/mcp.ts.
async function main() {
  assertEnv();
  const server = createTwentyThreeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TwentyThree MCP Server (OAuth 1.0a) running on Stdio...");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
