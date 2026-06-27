# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Model Context Protocol (MCP) gateway** deployed on Cloudflare Workers. Each Clerk-authenticated user can register named configurations and expose each one as an MCP endpoint at `/mcp/<slug>`.

- `https://<host>/mcp/<slug>` — Streamable-HTTP MCP endpoint.
- `https://<host>/sse/<slug>` — deprecated SSE transport, same scoping.
- `https://<host>/app/configs` — TanStack Start web UI to manage configs (Clerk session auth).
- `https://<host>/api/configs[...]` — JSON API the UI talks to (Clerk session auth).

Built on Cloudflare Workers, served from a single Worker (UI + API + MCP) via the Cloudflare Vite plugin + TanStack Start. OAuth 2.1 for MCP clients via `@cloudflare/workers-oauth-provider` (Clerk is the upstream IdP); browser sessions via `@clerk/tanstack-react-start`.

## Architecture

Top-level entrypoint: **`src/server.ts`** (the `main` in `wrangler.jsonc`). It dispatches by URL:

| Pattern | Handler |
| --- | --- |
| `/(mcp\|sse)/<slug>(/...)?` | Strips `<slug>` from the path, sets header `X-Config-Slug: <slug>`, forwards to `oauthProvider.fetch` (rewritten to `/mcp` or `/sse`). |
| `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*` | `oauthProvider.fetch` (unchanged). |
| `/api/...` | Hono app `apiApp` from `src/api/index.ts` (Clerk session middleware). |
| anything else | TanStack Start handler from `@tanstack/react-start/server-entry` (serves the UI). |

OAuthProvider responses pass through `wrapOAuthResponse()` (in `src/mcp/mcp-app.ts`) which preserves the legacy HTTPS-rewrite of OAuth metadata and the WWW-Authenticate enrichment on 401s.

### Layers

**1. OAuth layer** (`src/clerk-handler.ts`, `src/workers-oauth-utils.ts`) — Mints MCP tokens encrypting `Props` (userId, sessionId, email, names, imageUrl).

**2. MCP server** (`src/mcp/mcp-app.ts`)
- `MyMCP` extends `McpAgent`. `init()` pre-initializes tool request handlers. Register tools here.
- DO routing: one DO per MCP session ID (header `mcp-session-id`).

**3. Storage** (`src/storage.ts`)
- `ConfigRecord` — `slug`, `displayName`, `apiKey`, `baseUrl?`, `createdAt`, `updatedAt`.
- `cfgKey(userId, slug) = 'ws:cfg:<userId>:<slug>'`, `load/save/delete/listConfigs`, `validateSlug`, `redactApiKey`.

**4. JSON API** (`src/api/index.ts`) — Hono app. Auth middleware: `@clerk/backend`'s `createClerkClient`. Routes (mounted under `/api`):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/configs` | List user's configs. apiKey redacted. |
| POST | `/configs` | Create. Zod-validated body. |
| GET | `/configs/:slug` | One config. apiKey redacted. |
| PATCH | `/configs/:slug` | Partial update. apiKey optional. |
| DELETE | `/configs/:slug` | 204. |

**5. UI** (`app/`, TanStack Start):
```
app/
  routes/
    __root.tsx           # ClerkProvider + Toaster shell
    index.tsx            # redirects /sign-in or /app/configs based on auth
    sign-in.tsx          # Clerk <SignIn/>
    app/route.tsx        # /app/* auth gate + nav
    app/configs/
      index.tsx          # list table
      new.tsx            # create form
      $slug.tsx          # edit + delete
  lib/api.ts             # typed fetch wrappers for /api/configs
  lib/auth.ts            # requireAuthFn server fn (redirects to /sign-in)
```

## Secrets / env vars

| Secret | Purpose |
| --- | --- |
| `CLERK_CLIENT_ID` | Clerk OAuth client id (for MCP-side OAuth) |
| `CLERK_CLIENT_SECRET` | Clerk OAuth client secret |
| `CLERK_SECRET_KEY` | `sk_…` — used by `@clerk/backend` to verify JWTs and sessions |
| `CLERK_PUBLISHABLE_KEY` | `pk_…` — required by `@clerk/backend` to fetch JWKS; UI also reads it client-side |
| `CLERK_FRONTEND_API` | e.g. `https://your-subdomain.clerk.accounts.dev` |
| `COOKIE_ENCRYPTION_KEY` | `openssl rand -hex 32` |

## Development

### Setup
1. `bun install`
2. Create a Clerk application at https://dashboard.clerk.com
3. Redirect URI for the MCP OAuth app: `http://localhost:8788/callback`
4. Copy `.env.example` to `.env`; fill in the Clerk + cookie vars above.
5. `bun run dev` — serves on http://localhost:8788

### Scripts
- `bun run dev` / `bun start` → `vite dev`
- `bun run build` → `vite build`
- `bun run deploy` → `vite build && wrangler deploy`
- `bun run type-check` → `tsc --noEmit`
- `bun run lint` → biome

### Adding tools
Register tools in `MyMCP.init()` in `src/mcp/mcp-app.ts`. Use `this.server.tool(...)` and `this.props` (userId, email, etc.) and `this.env` (KV, etc.).

### Production deploy
1. Set Clerk redirect URI to `https://<host>/callback`.
2. `wrangler secret put` the secrets above.
3. `wrangler kv namespace create OAUTH_KV` and paste the id into `wrangler.jsonc`.
4. `bun run deploy`.

## Key dependencies

- `@clerk/backend` — JWT/session verification on the server.
- `@clerk/tanstack-react-start` — UI auth.
- `@cloudflare/workers-oauth-provider` — OAuth 2.1 server.
- `@cloudflare/vite-plugin` — Workers runtime via Vite.
- `@modelcontextprotocol/sdk` + `agents` — MCP server + Durable MCP.
- `@tanstack/react-start` + `@tanstack/react-router` — UI framework.
- `hono` — `/api/*` routing.
- shadcn/ui + Tailwind v4 — components.
- `zod` — input validation.

## Common Gotchas

1. **MCP path requires a slug**: `/mcp` alone is unrouted (404). Always `/mcp/<slug>`.
2. **Slug is sealed per DO session**: connect a fresh session per slug.
3. **`/api/configs` returns 500 without Clerk keys**: set `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` in `.env`.
4. **Cloudflare Vite plugin + multi-account**: `bun run dev` fails with "More than one account available" if you have multiple CF accounts and no `CLOUDFLARE_ACCOUNT_ID`. `remoteBindings: false` in `vite.config.ts` avoids the remote proxy session.
5. **SSE vs Streamable-HTTP**: `/sse/<slug>` is deprecated; use `/mcp/<slug>` for new clients.
6. **KV Namespace ID**: must be set in `wrangler.jsonc` before deployment.
7. **`wrangler types` drops secrets**: don't regenerate `worker-configuration.d.ts` without re-adding secret declarations first.
8. **Route generation**: `tanstackStart()` in `vite.config.ts` uses `routesDirectory: '../app/routes'` (relative to `srcDirectory: 'src'`).
