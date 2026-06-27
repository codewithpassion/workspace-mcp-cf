# Workspace MCP

A multi-tenant [Model Context Protocol](https://modelcontextprotocol.io) gateway deployed on Cloudflare Workers. Each authenticated user can register named configurations through a web UI and expose each one as its own MCP endpoint at `/mcp/<slug>`. MCP clients authenticate via OAuth 2.1 (Clerk as the upstream identity provider).

Built on Cloudflare Workers (Durable Objects + KV) with TanStack Start for the UI, [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) for OAuth, and [`@clerk/backend`](https://clerk.com) for identity.

## Architecture

```
                                   ┌───────────────────┐
                                   │ TanStack Start UI │  /app/configs
   browser  ──────cookie auth───── │  + Hono /api/*    │  /api/configs/...
                                   └─────────┬─────────┘
                                             │ KV: ws:cfg:<userId>:<slug>
                                             ▼
┌──────────────┐         ┌────────────────────────────────────┐
│ MCP client   │ ──OAuth─▶ @cloudflare/workers-oauth-provider │
│ (Claude etc) │         └─────────────┬──────────────────────┘
└──────────────┘                       │
                                       ▼
                            ┌──────────────────────┐
            /mcp/<slug> ───▶│ MyMCP Durable Object │
                            │ (per session)        │
                            └──────────────────────┘
```

## Getting started

### Prerequisites

- [Bun](https://bun.sh)
- A [Clerk](https://clerk.com) application
- A Cloudflare account (for deployment)

### Local development

1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   ```env
   CLERK_CLIENT_ID=...
   CLERK_CLIENT_SECRET=...
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_FRONTEND_API=https://your-subdomain.clerk.accounts.dev
   COOKIE_ENCRYPTION_KEY=<openssl rand -hex 32>
   ```

3. **Run the dev server**
   ```bash
   bun run dev
   ```
   Open http://localhost:8788. Sign in, go to **MCP configurations**, click **New config**.

4. **Test with MCP Inspector**
   ```bash
   bunx @modelcontextprotocol/inspector@latest
   ```
   Connect to `http://localhost:8788/mcp/<your-slug>` and complete the OAuth flow.

### Configuring Clerk

1. Create an application at the [Clerk Dashboard](https://dashboard.clerk.com).
2. Go to **Configure → OAuth applications** → **Add OAuth application**.
3. Set the redirect URL to `http://localhost:8788/callback` (local) or `https://<host>/callback` (production).
4. Required scopes: `openid`, `profile`, `email`, `offline_access`.
5. Copy **Client ID**, **Client secret**, **Secret key**, **Publishable key**, and **Frontend API URL** into your `.env`.

### Production deployment

1. Add `https://<your-host>/callback` to the Clerk OAuth application's redirect URLs.
2. Create the KV namespace:
   ```bash
   wrangler kv namespace create OAUTH_KV
   ```
   Paste the id into `wrangler.jsonc`.
3. Set secrets:
   ```bash
   wrangler secret put CLERK_CLIENT_ID
   wrangler secret put CLERK_CLIENT_SECRET
   wrangler secret put CLERK_SECRET_KEY
   wrangler secret put CLERK_PUBLISHABLE_KEY
   wrangler secret put CLERK_FRONTEND_API
   wrangler secret put COOKIE_ENCRYPTION_KEY
   ```
4. Deploy:
   ```bash
   bun run deploy
   ```

## Connecting MCP clients

Each config exposes:

- `https://<host>/mcp/<slug>` — Streamable HTTP (preferred)
- `https://<host>/sse/<slug>` — SSE (deprecated, still supported)

### Claude Desktop / Cursor / Windsurf

```json
{
  "mcpServers": {
    "my-workspace": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-host>/mcp/my-workspace"]
    }
  }
}
```

## Adding tools

Register tools in `MyMCP.init()` in `src/mcp/mcp-app.ts`:

```ts
async init() {
  (this.server as unknown as { setToolRequestHandlers(): void }).setToolRequestHandlers();

  this.server.tool("my_tool", "description", { param: z.string() }, async ({ param }) => ({
    content: [{ type: "text", text: `Result: ${param}` }],
  }));
}
```

Use `this.props` for user identity (userId, email) and `this.env` for Worker bindings (KV, etc.).

## Tech stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + Durable Objects + KV
- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) — OAuth 2.1 server
- [`@clerk/backend`](https://clerk.com) + [`@clerk/tanstack-react-start`](https://clerk.com) — identity
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) + [`agents`](https://github.com/cloudflare/agents) — Durable MCP
- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) — UI
- [Hono](https://hono.dev) — `/api/*`
- [shadcn/ui](https://ui.shadcn.com) + Tailwind v4 — components
- [Zod](https://zod.dev) — schema validation
- [Bun](https://bun.sh) — package manager

## License

[Apache 2.0](LICENSE)
