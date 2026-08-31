import "dotenv/config";
import http from "http";
import handler from "../api/mcp.js";

// Minimal local runner for the HTTP transport, so it can be smoke-tested
// with `npm run dev:http` without needing the Vercel CLI. Mirrors the
// deployed route: POST /api/mcp.
const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/api/mcp") {
    handler(req, res);
    return;
  }
  res.writeHead(404).end("Not found. POST to /api/mcp.");
});

server.listen(PORT, () => {
  console.error(`TwentyThree MCP Server (HTTP) listening on http://localhost:${PORT}/api/mcp`);
});
