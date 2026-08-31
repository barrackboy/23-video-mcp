# 23-video-mcp

An MCP server exposing TwentyThree video-platform tools (search, transcripts,
metadata updates, channels, analytics) over the MCP **Streamable HTTP**
transport, deployable as a Vercel serverless function.
 
## Structure

- `src/server.ts` — tool definitions, shared by both transports.
- `api/mcp.ts` — Vercel serverless function (`POST /api/mcp`), stateless
  Streamable HTTP transport. This is the entry point used in production.
- `src/index.ts` — local/desktop entry point using stdio (e.g. for a Claude
  Desktop `mcpServers` config).
- `src/local-http.ts` — thin local runner for `api/mcp.ts` so the HTTP
  transport can be smoke-tested without the Vercel CLI.

## Environment variables

```
TWENTYTHREE_DOMAIN=
TWENTYTHREE_CONSUMER_KEY=
TWENTYTHREE_CONSUMER_SECRET=
TWENTYTHREE_ACCESS_TOKEN=
TWENTYTHREE_ACCESS_TOKEN_SECRET=
```

Set these in Vercel under Project Settings → Environment Variables. For local
development, put them in a `.env` file (not committed — see below).

## Local development

```bash
npm install
npm run dev:http
```

This builds the project and serves the MCP endpoint at
`http://localhost:3000/api/mcp`. Test it with:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Alternatively, once the Vercel CLI is linked to this project, `vercel dev`
runs the same `api/mcp.ts` function directly.

## Deploying to Vercel

```bash
vercel
```

or connect the GitHub repo in the Vercel dashboard for git-based deploys.
The MCP endpoint will be available at `https://<your-project>.vercel.app/api/mcp`.

## Local/desktop (stdio) usage

```bash
npm run build
npm run start:stdio
```

Point a stdio-based MCP client (e.g. Claude Desktop) at
`node build/src/index.js` with the environment variables above.

## Security note

`.env` must never be committed — it holds live OAuth credentials. If it was
ever committed to this repo's git history, rotate the TwentyThree consumer
key/secret and access token/secret, then scrub the history (e.g. with
`git filter-repo`) before treating the repo as safe to share.
