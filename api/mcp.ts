import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTwentyThreeServer } from "../src/server.js";

// Vercel Node.js Serverless Function entry point, mounted at /api/mcp.
// Runs the Streamable HTTP transport in stateless mode: a fresh McpServer +
// transport is created per request, since serverless invocations don't share
// in-memory state across requests (or even across concurrent requests on the
// same warm instance).

interface VercelLikeRequest extends IncomingMessage {
  body?: unknown;
}

// Vercel parses JSON request bodies into req.body automatically. When this
// handler runs somewhere that doesn't do that (e.g. a plain Node http
// server), read and parse the raw stream ourselves.
async function readJsonBody(req: VercelLikeRequest): Promise<unknown> {
  if (req.body !== undefined) return req.body;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

export default async function handler(req: VercelLikeRequest, res: ServerResponse) {
  if (req.method !== "POST") {
    // Stateless mode has no server-to-client SSE stream (GET) or session
    // teardown (DELETE) to support — only direct request/response over POST.
    res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed. Use POST." },
        id: null,
      })
    );
    return;
  }

  try {
    const server = createTwentyThreeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    const body = await readJsonBody(req);
    await transport.handleRequest(req, res, body);
  } catch (error: any) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error", data: error?.message },
          id: null,
        })
      );
    }
  }
}
