# Master Prompt — Reproduce plane-mcp-gw from boilerplate

Paste this into a fresh Claude Code session sitting on the original "remote MCP server with OAuth + Clerk" boilerplate (Cloudflare Workers + `@cloudflare/workers-oauth-provider` + `agents`/`McpAgent`, with a single DO `MyMCP` and the demo `add` / `userInfo` / `generateImage` tools) to reproduce the current end state.

---

ULTRATHINK. Read this entire prompt before doing anything. We are going to take this Cloudflare Workers MCP-server boilerplate (workers-oauth-provider + agents/McpAgent + Clerk-as-IdP, with a single DO `MyMCP` and the demo `add` / `userInfo` / `generateImage` tools) and turn it into a multi-tenant Plane MCP gateway. Work in PHASES; commit at the end of each phase; do not jump ahead.

────────────────────────────────────────────────────────────
PHASE 1 — Translate the Python Plane MCP server to TypeScript
────────────────────────────────────────────────────────────
Fetch https://github.com/makeplane/plane-mcp-server.git and port the entire tool suite (~109 tools across projects, work-items, cycles, modules, labels, states, comments, links, activities, work-item-types, properties, relations, pages, milestones, initiatives, intake, work-logs, members, workspace/project features, epics, etc.) to TypeScript under `src/plane/`.

Layout:
  src/plane/
    client.ts            # planeFetch(config, method, path, {params?, body?}) with retry/backoff. PlaneAppContext = { config, workspaceSlug, projectId? }.
    errors.ts            # PlaneError, HttpError, ConfigurationError
    types/<resource>.ts  # response shapes — permissive ({ [key: string]: unknown })
    resources/<resource>.ts  # one function per Plane endpoint
    tools/<resource>.ts      # one register*Tools(server, ctx) per resource
    tools/_helpers.ts        # toolResult(fn), stripNullish(obj) (mirrors pydantic exclude_none)
    tools/index.ts           # registerPlaneTools(server, ctx) — calls every register*Tools
Rules:
  - Tool names and parameter names must match the Python server VERBATIM (snake_case).
  - planeFetch paths do NOT include `/api/v1/` and have NO trailing slash — the client adds both.
  - Work items endpoint is `/work-items/` (hyphenated), NOT `/issues/`. Trust Python SDK paths over Plane docs.
  - Use stripNullish() on POST/PATCH bodies.
  - Use zod for input schemas.

For this phase ONLY, drive Plane config from env vars: `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL` (default https://api.plane.so). Register the Plane tools in `MyMCP.init()` alongside the demo tools.

You may delegate resource-bundle ports to parallel subagents (e.g. work-items+states+labels, cycles+modules, pages+milestones+initiatives+intake+work_logs, etc.) but the lead must reconcile types/index.ts and tools/_helpers.ts.

Verify: `bun run type-check` and `bun run lint` clean. Commit.

────────────────────────────────────────────────────────────
PHASE 2 — Multi-tenant: KV-stored configs, slug-routed MCP, Clerk-auth UI + API
────────────────────────────────────────────────────────────
Goal: a user signs in with Clerk, registers multiple Plane configurations in a web UI, and connects an MCP client to `https://<host>/mcp/<slug>` (and `/sse/<slug>` deprecated) — each slug picks its own Plane workspace+API key.

Replace env vars entirely. New top-level entrypoint `src/server.ts` (set as `main` in wrangler.jsonc) dispatches by URL:
  - `/(mcp|sse)/<slug>(/...)?` → strip slug, set header `X-Plane-Config-Slug`, rewrite path to `/mcp` or `/sse`, forward to oauthProvider.fetch.
  - `/authorize|/callback|/register|/token|/.well-known/*` → oauthProvider.fetch.
  - `/api/...` → Hono `apiApp` (Clerk session middleware via @clerk/backend `authenticateRequest`).
  - else → TanStack Start handler from `@tanstack/react-start/server-entry`.
Preserve the existing `wrapOAuthResponse()` (HTTPS-rewrite of OAuth metadata + WWW-Authenticate enrichment on 401).

Storage (`src/plane/storage.ts`):
  - `PlaneConfigRecord = { slug, name, apiKey, baseUrl, workspaceSlug, projectId?, createdAt, updatedAt }`
  - `cfgKey(userId, slug) = 'plane:cfg:<userId>:<slug>'` in OAUTH_KV
  - load/save/delete/listConfigs; `validateSlug` (regex + reserved list including "well-known", "mcp", "sse", "api", "app"); `redactApiKey` → `••••<last4>`.

MCP layer (`src/mcp/mcp-app.ts`):
  - `MyMCP.init()` stays EMPTY (Plane tools are per-slug).
  - Override `fetch(request)`: read `X-Plane-Config-Slug`; seal slug to DO on first request (mismatch → 400); `loadConfig(env, props.userId, slug)` from KV; 404 if missing (post-auth); call `registerPlaneTools(this.server, ctx)` once.
  - One DO per `mcp-session-id` header → (session, slug) effectively 1:1.

JSON API (`src/api/index.ts`, Hono, mounted at /api):
  - Middleware: createClerkClient({ secretKey, publishableKey }) + authenticateRequest → 401 on failure.
  - GET/POST `/configs`, GET/PATCH/DELETE `/configs/:slug` (apiKey always redacted on read; zod validation on writes).
  - POST `/configs/:slug/test` → `GET /workspaces/<workspaceSlug>` against Plane → `{ ok, workspace?|error? }`.
  - GET `/configs/:slug/projects` → list projects for the workspace (used by UI picker) → `[{id,name,identifier}]`.

UI (`app/` with TanStack Start + shadcn/ui + Tailwind v4, file-based routes):
  app/routes/__root.tsx           # ClerkProvider + Toaster
  app/routes/index.tsx            # redirect /sign-in or /app/configs based on auth
  app/routes/sign-in.tsx          # Clerk <SignIn/>
  app/routes/app/route.tsx        # auth gate + nav + <UserButton/>
  app/routes/app/configs/{index,new,$slug}.tsx   # list / create / edit+delete+test
  app/lib/api.ts                  # typed fetch wrappers for /api/configs
  app/lib/auth.ts                 # requireAuthFn server fn

Edit `vite.config.ts` so `tanstackStart({ router: { routesDirectory: 'app/routes', generatedRouteTree: 'app/routeTree.gen.ts' } })`. Pin Vite server port to 8788; set `remoteBindings: false` (avoids "More than one CF account" errors).

Wrangler:
  - `main`: src/server.ts; compatibility_date 2026-05-01; compatibility_flags ["nodejs_compat"]; `dev.port: 8788`.
  - Drop all PLANE_* vars. Keep OAUTH_KV, MCP_OBJECT (DO `MyMCP`).

Secrets to document in .env.example + README: CLERK_CLIENT_ID, CLERK_CLIENT_SECRET, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_FRONTEND_API, COOKIE_ENCRYPTION_KEY.

On the configs list page, show the per-config MCP URL (`<origin>/mcp/<slug>`) with a copy button.

You may run this as an agent team: lead does scaffold + vite/wrangler/deps + integration; backend does storage+mcp dispatch+Hono api; frontend does TanStack Start routes+shadcn UI. Lead resolves cross-cutting issues and writes CLAUDE.md at the end.

Verify: dev server boots; `/` 307→`/sign-in` unauthed; after sign-in `/app/configs` works; create a config and confirm `/mcp/<slug>` is reachable through the OAuth flow. Commit.

────────────────────────────────────────────────────────────
PHASE 3 — Project pinning (optional per-config)
────────────────────────────────────────────────────────────
A config may optionally pin one Plane project (`PlaneConfigRecord.projectId`). When pinned:
  - `tools/_helpers.ts` exposes `projectIdField(ctx)` returning `{}` (no schema field) and `requireProjectId(ctx, params)` returning `ctx.projectId`.
  - EVERY tool that previously took `project_id` consults these helpers — the parameter disappears from the schema entirely when pinned.
  - `list_projects`, `create_project`, `delete_project` tools are NOT REGISTERED when pinned.
  - `retrieve_project` / `update_project` / `*_features` / member tools still register but operate against the pinned id.
When NOT pinned, `project_id` is required on every project-scoped tool (original behaviour).

UI:
  - New config form: after API key + base URL + workspace slug are filled, a "Load projects" button calls `/api/configs/:slug/projects` (or a draft variant) and renders a select to choose "All projects" or a specific one.
  - Edit page: same selector, pre-filled.

Auto-refresh tools on config change (don't require DO restart):
  - On EVERY MCP request, reload the config from KV and compare `updatedAt` against the last-registered version. On change: `remove()` all Plane tools and call `registerPlaneTools` again — `notifications/tools/list_changed` fires automatically. On config deletion: tear down tools and return HTTP 410.
  - Note: KV is eventually consistent (≤ ~60 s cross-colo).

Verify by editing a config in the UI and observing the MCP Inspector pick up the new tool list within a few seconds. Commit.

────────────────────────────────────────────────────────────
PHASE 4 — Pre-load context into MCP instructions + URL injection
────────────────────────────────────────────────────────────
Problem: with an unpinned config, Claude always has to call `list_projects` before doing anything, and when asked "what's the URL of the issue you just created?" it hallucinates `app.plane.so/...`.

Look up the LATEST MCP spec (use web fetches, not training data) for how `instructions` and resources are intended to be used, and how Claude consumes them. Then:

1. Pre-load the Plane project list into the MCP server's `instructions` text at (re)compute time — fetch projects on first request per (user,slug), cache in the DO, and include them in a short, structured block: workspace name, workspace URL, and a project table (`identifier — name — id`).
2. Include the workspace base URL AND URL patterns verbatim in the instructions so the model can construct correct links:
     Work item:    <base>/<workspace>/projects/<project_id>/work-items/<work_item_id>/
     Project home: <base>/<workspace>/projects/<project_id>/
     Cycle:        <base>/<workspace>/projects/<project_id>/cycles/<cycle_id>/
     Module:       <base>/<workspace>/projects/<project_id>/modules/<module_id>/
     Page:         <base>/<workspace>/projects/<project_id>/pages/<page_id>/
3. Log the full instructions text whenever it is (re)computed, for debugging.
4. Inject a `web_url` field into the result payloads of ALL `create_*`, `list_*`, and `get_*` / `retrieve_*` tools, computed from the URL patterns above — because experience shows the model doesn't reliably consult `instructions` for links. ULTRATHINK about which result shapes need which URL kind (list items each get their own web_url; single retrieves get one).
5. Fix the bug "Error: Cannot register capabilities after connecting to transport" by pre-initializing the tool request handlers BEFORE the transport connects (i.e. register stub handlers in init/fetch ordering so capability registration happens pre-connect; subsequent tool list refreshes use add/remove + list_changed, which is allowed post-connect).

Commit.

────────────────────────────────────────────────────────────
PHASE 5 — Polish: license, README, Clerk docs, dead-code cleanup
────────────────────────────────────────────────────────────
1. Add `LICENSE` (Apache 2.0).
2. Rewrite `README.md` from scratch (the template README is obsolete). Use `docs/screenshot.png` as a hero image. Cover: what this is, architecture diagram (URL → server.ts dispatch → MCP/API/UI), feature list, prerequisites, local dev (bun install, .env, bun run dev on :8788), production deploy (wrangler secret puts, wrangler kv namespace create OAUTH_KV, bun run deploy), connecting an MCP client to `/mcp/<slug>`.
3. Clerk setup section: tell the user to create an OAuth application in Clerk with redirect URL `https://<host>/callback` and the EXACT scopes `email offline_access openid profile public_metadata`.
4. Remove all demo cruft: the `add`, `userInfo`, `generateImage` tools; the `ALLOWED_ROLES` constant; the Cloudflare `AI` binding from wrangler.jsonc and the env type. Do not leave back-compat shims.
Commit and push to origin/main.

────────────────────────────────────────────────────────────
FINAL CHECKS
────────────────────────────────────────────────────────────
- `bun run type-check` and `bun run lint` are clean.
- CLAUDE.md reflects the final architecture (server.ts dispatch, layers, project pinning, auto-refresh, gotchas: slug-sealed DO, `/work-items/` not `/issues/`, planeFetch path rules, KV staleness).
- A new MCP client connecting to `/mcp/<slug>` sees: server instructions with workspace + project table + URL patterns, the right tool subset (pinned vs unpinned), and tool results carrying `web_url` fields.

Treat the CLAUDE.md in this repo as the authoritative spec of the END STATE — if anything you build disagrees with it, the CLAUDE.md wins and you should fix your implementation, not the doc. Begin Phase 1.
