# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Model Context Protocol (MCP) gateway** for [Plane](https://plane.so). Each Clerk-authenticated user can register multiple Plane configurations and address each one by a URL slug:

- `https://<host>/mcp/<slug>` — Streamable-HTTP MCP endpoint scoped to the named Plane config.
- `https://<host>/sse/<slug>` — deprecated SSE transport, same scoping.
- `https://<host>/app/configs` — TanStack Start web UI to manage configs (Clerk session auth).
- `https://<host>/api/configs[...]` — JSON API the UI talks to (Clerk session auth).

Built on Cloudflare Workers, served from a single Worker (UI + API + MCP) via the Cloudflare Vite plugin + TanStack Start. OAuth 2.1 for MCP clients via `@cloudflare/workers-oauth-provider` (Clerk is the upstream IdP); browser sessions via `@clerk/tanstack-react-start`.

## Architecture

Top-level entrypoint: **`src/server.ts`** (the `main` in `wrangler.jsonc`). It dispatches by URL:

| Pattern | Handler |
| --- | --- |
| `/(mcp\|sse)/<slug>(/...)?` | Strips `<slug>` from the path, sets header `X-Plane-Config-Slug: <slug>`, forwards to `oauthProvider.fetch` (rewritten to `/mcp` or `/sse`). |
| `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*` | `oauthProvider.fetch` (unchanged). |
| `/api/...` | Hono app `apiApp` from `src/api/index.ts` (Clerk session middleware). |
| anything else | TanStack Start handler from `@tanstack/react-start/server-entry` (serves the UI). |

OAuthProvider responses pass through `wrapOAuthResponse()` (in `src/mcp/mcp-app.ts`) which preserves the legacy HTTPS-rewrite of OAuth metadata and the WWW-Authenticate enrichment on 401s.

### Layers

**1. OAuth layer** (`src/clerk-handler.ts`, `src/workers-oauth-utils.ts`) — unchanged. Mints MCP tokens encrypting `Props` (userId, sessionId, email, names, imageUrl).

**2. MCP server** (`src/mcp/mcp-app.ts`)
- `MyMCP` extends `McpAgent`. `init()` is empty — Plane tools are registered lazily in `fetch()` once a slug is known. Add slug-independent tools to `init()` if you need any.
- Override `fetch(request)` reads `X-Plane-Config-Slug`, seals the slug to the DO instance on first request (later requests with a different slug get HTTP 400), lazy-loads the config from `OAUTH_KV` via `loadConfig(env, props.userId, slug)`, and calls `registerPlaneTools()` once. Missing config → 404 (post-auth).
- DO routing: one DO per MCP session ID (header `mcp-session-id`), so `(session, slug)` pairs map 1:1 in practice — a client only hits one slug per session.

**3. Plane tool suite** (`src/plane/`)
- ~109 tools, ported from the Python `plane-mcp-server`. Tool names / params verbatim.
- `client.ts` — `planeFetch()` (retry/backoff) + `PlaneAppContext` type (`config`, `workspaceSlug`, optional `projectId`).
- `storage.ts` — `PlaneConfigRecord`, `cfgKey(userId, slug) = 'plane:cfg:<userId>:<slug>'`, `load/save/delete/listConfigs`, `validateSlug`, `redactApiKey`.
- `errors.ts` — `PlaneError`, `HttpError`, `ConfigurationError`.
- `types/`, `resources/`, `tools/` — one file per Plane resource. `tools/_helpers.ts` provides `toolResult(fn)`, `stripNullish(obj)`, and the project-pinning helpers `projectIdField(ctx, opts?)` / `resolveProjectId(ctx, params)` / `requireProjectId(ctx, params)`.

### Project pinning

A config may optionally pin a single Plane project (`PlaneConfigRecord.projectId`). When pinned:
- Tool schemas omit the `project_id` parameter entirely — `projectIdField(ctx)` returns `{}` and `requireProjectId(ctx, params)` reads `ctx.projectId`.
- `list_projects`, `create_project`, and `delete_project` tools are not registered.
- `retrieve_project` / `update_project` / `*_features` / member tools still register, but operate against the pinned project.

When NOT pinned, every tool that touches a project takes a required `project_id` (the original behavior).

**4. JSON API** (`src/api/index.ts`) — Hono app. Auth middleware: `@clerk/backend`'s `createClerkClient({ secretKey, publishableKey })` + `authenticateRequest()` → 401 on any failure. Routes (mounted under `/api` by `src/server.ts`, which strips the prefix):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/configs` | List user's configs. apiKey redacted. |
| POST | `/configs` | Create. Zod-validated body. |
| GET | `/configs/:slug` | One config. apiKey redacted. |
| PATCH | `/configs/:slug` | Partial update. apiKey optional. |
| DELETE | `/configs/:slug` | 204. |
| POST | `/configs/:slug/test` | Calls Plane `GET /workspaces/<workspaceSlug>`. Returns `{ ok, workspace? \| error? }`. |
| GET | `/configs/:slug/projects` | Lists projects for the config's workspace (used by the UI project picker). Returns `[{ id, name, identifier }]`. |

The stored `apiKey` is never returned over the wire — always `••••<last4>`.

**5. UI** (`app/`, TanStack Start) — file-based routes:
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
      $slug.tsx          # edit + delete + test-connection
  lib/api.ts             # typed fetch wrappers for /api/configs
  lib/auth.ts            # requireAuthFn server fn (redirects to /sign-in)
```
Clerk middleware lives in `src/start.ts` via `createStart()` + `clerkMiddleware()`. Router entry in `src/router.tsx`. shadcn/ui (Tailwind v4) for components.

### Data flow (MCP client)
1. Client connects to `/mcp/<slug>`.
2. `src/server.ts` rewrites path to `/mcp`, adds `X-Plane-Config-Slug`, forwards to OAuthProvider.
3. OAuthProvider checks bearer token. If missing/invalid → 401 (with WWW-Authenticate). Otherwise routes to the DO.
4. DO's `MyMCP.fetch` seals the slug, loads the config from KV, registers Plane tools for that config, delegates to `McpAgent.fetch`.
5. Tools run with the per-slug Plane API key/workspace.

### Data flow (browser user)
1. Hits `/` → `requireAuthFn` server fn checks Clerk session → 307 to `/sign-in` if missing.
2. Signs in via Clerk → lands on `/app/configs`.
3. Mutations go to `/api/configs/*` over same-origin fetch (Clerk cookies auto-included).

## Security

OAuth state and session-binding cookies are unchanged from before (`workers-oauth-utils.ts`): state token in KV, 600 s TTL, `__Host-CONSENTED_STATE` + `__Host-CSRF_TOKEN` cookies, one-time use, HTML escaping on URLs.

API keys for Plane are stored as-is in KV (server-only). Envelope encryption with `COOKIE_ENCRYPTION_KEY` is a follow-up if/when needed.

Access control: configs are private to their Clerk `userId` (KV key includes the user id). No sharing / org model in step 1.

## Secrets / env vars

Worker secrets (`wrangler secret put` or `.env`):

| Secret | Purpose |
| --- | --- |
| `CLERK_CLIENT_ID` | Clerk OAuth client id (for MCP-side OAuth) |
| `CLERK_CLIENT_SECRET` | Clerk OAuth client secret |
| `CLERK_SECRET_KEY` | `sk_…` — used by `@clerk/backend` to verify JWTs and sessions |
| `CLERK_PUBLISHABLE_KEY` | `pk_…` — required by `@clerk/backend` to fetch JWKS; UI also reads it client-side |
| `CLERK_FRONTEND_API` | e.g. `https://your-subdomain.clerk.accounts.dev` |
| `COOKIE_ENCRYPTION_KEY` | `openssl rand -hex 32` |

There are **no longer any `PLANE_*` env vars**. Plane configs live in `OAUTH_KV` under `plane:cfg:<userId>:<slug>`.

## Development

### Setup
1. `bun install`
2. Create a Clerk application at https://dashboard.clerk.com
3. Redirect URI for the MCP OAuth app: `http://localhost:8788/callback`
4. Copy `.env.example` to `.env`; fill in the Clerk + cookie vars above.
5. `bun run dev` — serves on http://localhost:8788

### Scripts
- `bun run dev` / `bun start` → `vite dev` (Cloudflare Vite plugin gives a real Workers runtime locally with DO + KV).
- `bun run build` → `vite build`.
- `bun run deploy` → `vite build && wrangler deploy`.
- `bun run type-check` → `tsc --noEmit`.
- `bun run lint` → biome.
- `bun run cf-typegen` → `wrangler types` (re-generate `worker-configuration.d.ts`; see Environment Types).

### Testing MCP locally
```bash
bun run dev
# In another terminal:
bunx @modelcontextprotocol/inspector@latest
# Connect URL: http://localhost:8788/mcp/<your-slug>
```
The slug must already exist — create it in the UI at http://localhost:8788/app/configs.

### Adding tools
1. **Top-level tools** (always available): in `MyMCP.init()` in `src/mcp/mcp-app.ts`. Use `this.props` and zod.
2. **Plane tools** (per-config): add to the matching `src/plane/tools/<resource>.ts`. Template:
   ```ts
   server.tool("snake_case_name", "description", { /* zod shape */ }, async (params) =>
     toolResult(() => resource.method(ctx.config, ctx.workspaceSlug, params)),
   );
   ```
   Underlying HTTP call in `src/plane/resources/<resource>.ts` via `planeFetch(config, method, path, { params?, body? })`. Paths must NOT include `/api/v1/` and don't need a trailing slash — the client adds both. Use `stripNullish(body)` on POST/PATCH bodies (mirrors pydantic `model_dump(exclude_none=True)`).
3. **New resource**: also wire its `register*Tools` into `src/plane/tools/index.ts`.

### Production deploy
1. Set Clerk redirect URI to `https://<host>/callback`.
2. `wrangler secret put` the secrets in the table above (no `PLANE_*`).
3. `wrangler kv namespace create OAUTH_KV` and paste the id into `wrangler.jsonc`.
4. `bun run deploy`.

## Key dependencies

- `@clerk/backend` — JWT/session verification on the server.
- `@clerk/tanstack-react-start` — UI auth (`clerkMiddleware`, `<SignIn/>`, `<UserButton/>`).
- `@cloudflare/workers-oauth-provider` — OAuth 2.1 server.
- `@cloudflare/vite-plugin` — Workers runtime via Vite.
- `@modelcontextprotocol/sdk` + `agents` — MCP server + Durable MCP.
- `@tanstack/react-start` + `@tanstack/react-router` — UI framework.
- `hono` — `/api/*` routing.
- shadcn/ui + Tailwind v4 — components.
- `zod` — input validation.

## Configuration

### wrangler.jsonc
- `main`: `src/server.ts`.
- `compatibility_date`: `2026-05-01`, `compatibility_flags: ["nodejs_compat"]`.
- `MCP_OBJECT` (DO `MyMCP`), `OAUTH_KV` (also used for Plane configs), `AI` binding.
- `dev.port: 8788`. Vite's `server.port` is also pinned to 8788 in `vite.config.ts`.

### Environment Types
- `worker-configuration.d.ts` is generated by `bun run cf-typegen` from `wrangler.jsonc`. **It drops secrets on regeneration** — secrets are only known via `wrangler secret` / `.env`, not by `wrangler types`. The currently-checked-in file was generated when Clerk vars were temporarily declared in `wrangler.jsonc`; do not regenerate without re-adding Clerk + cookie vars first.

## Common Gotchas

1. **MCP path requires a slug**: `/mcp` alone is unrouted (404). Always `/mcp/<slug>`. The bare `/mcp` route exists only as an internal target the dispatcher rewrites to.
2. **Slug is sealed per DO session**: an MCP client cannot reuse one session against two slugs — the second request 400s. Connect a fresh session per slug.
3. **Tools auto-refresh on config change**: each MCP request reloads the config from KV and compares `updatedAt` against the last-registered version. On change, all Plane tools are `remove()`d and re-registered (MCP `notifications/tools/list_changed` is emitted automatically). On config deletion, tools are torn down and the request returns 410. Note: KV reads have up to ~60 s of cross-colo staleness, so changes typically propagate within seconds but may take up to a minute in the worst case.
4. **`/api/configs` returns 500 without Clerk keys**: in keyless mode the UI works for sign-in but `@clerk/backend` can't validate sessions. Set `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` in `.env` to exercise the API.
5. **Cloudflare Vite plugin + multi-account**: `bun run dev` fails with "More than one account available" if you have multiple CF accounts and no `CLOUDFLARE_ACCOUNT_ID`. `remoteBindings: false` in `vite.config.ts` avoids the remote proxy session entirely — local miniflare bindings only.
6. **SSE vs Streamable-HTTP**: `/sse/<slug>` is deprecated; use `/mcp/<slug>` for new clients.
7. **KV Namespace ID**: must be set in `wrangler.jsonc` (placeholder `<Add-KV-ID>`) before deployment.
8. **Plane URL paths**: pass paths to `planeFetch` WITHOUT the `/api/v1/` prefix and WITHOUT a trailing slash — the client adds both. Mismatches surface as 404s with HTML bodies.
9. **Plane work items endpoint**: `/work-items/` (hyphenated), NOT `/issues/`. Older Plane docs still say `issues` — trust the Python SDK paths.
10. **`wrangler types` drops secrets**: see Environment Types. Don't regenerate without re-adding declarations first.
11. **Shared tsconfig has DOM lib**: the UI requires `"DOM"` in `compilerOptions.lib`, so server code also has `window`/`document` globally in scope (won't crash at runtime since SSR is fine, just looser typing). Splitting into referenced tsconfigs is a follow-up.
12. **Route generation**: `tanstackStart()` in `vite.config.ts` uses `routesDirectory: '../app/routes'` (relative to default `srcDirectory: 'src'`). `tsr.config.json` is for the standalone TanStack Router CLI only.
