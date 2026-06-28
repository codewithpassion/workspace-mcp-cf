# Workspace MCP — Google Workspace MCP Gateway on Cloudflare Workers

A **multi-tenant [Model Context Protocol](https://modelcontextprotocol.io) gateway** that exposes Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Tasks, Chat, Contacts, Search, Apps Script) to MCP clients such as Claude.

Each signed-in user can create **multiple MCP endpoints** — one per Google account — and choose **which services** each endpoint exposes. Every endpoint gets a unique URL:

```
https://<host>/mcp/<slug>
```

MCP clients connect to that URL and authenticate via OAuth 2.1; the gateway then calls the Google APIs on behalf of the Google account linked to that endpoint.

> **Origin / attribution.** This project is a **TypeScript + Cloudflare Workers port of the Python MCP server [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)** (v1.22.0). The tool surface (121 tools across 12 services), tool names, parameters, and behavior are modeled on that project. The auth model, transport, storage, and multi-tenant gateway around the tools are new and built for the Workers runtime. See [`docs/google-workspace-port-plan.md`](docs/google-workspace-port-plan.md) and [`docs/analysis/`](docs/analysis/) for the full port plan and source analysis, and [`docs/parity-gaps.md`](docs/parity-gaps.md) for the handful of tools that behave differently on Workers.

---

## What it does

- **Multi-tenant.** Users sign in (Clerk) and manage their own set of MCP endpoint configurations through a web UI.
- **Per-account.** Each configuration links to **one Google account** via its own Google OAuth flow. One user can run many endpoints for many Google accounts.
- **Per-service.** Each configuration enables a chosen subset of the 12 Google services; tools for disabled services refuse at call time.
- **121 tools** covering the full Google Workspace surface (see [Tool inventory](#tool-inventory)).
- **Serverless.** Runs entirely on one Cloudflare Worker (UI + JSON API + MCP server) with Durable Objects + KV.

## Tech stack

- **Cloudflare Workers** + Durable Objects + KV — runtime, per-session state, storage
- **[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)** — OAuth 2.1 server for MCP clients (Clerk as upstream IdP)
- **[Clerk](https://clerk.com)** (`@clerk/backend` + `@clerk/tanstack-react-start`) — user identity for the UI and MCP-client OAuth
- **[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) + [`agents`](https://github.com/cloudflare/agents)** — MCP server over Durable Objects (Streamable HTTP)
- **[TanStack Start](https://tanstack.com/start)** — the management UI
- **[Hono](https://hono.dev)** — the `/api/*` JSON API
- **[Zod](https://zod.dev)** — schema validation • **Bun** — package manager / scripts

---

## How it works

### Request routing

The Worker entrypoint is **`src/server.ts`**, which dispatches by URL:

| Pattern | Handler |
| --- | --- |
| `/(mcp\|sse)/<slug>(/...)?` | Strips `<slug>`, sets header `X-Config-Slug: <slug>`, forwards to the OAuth provider → the MCP Durable Object. |
| `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*` | `@cloudflare/workers-oauth-provider` (MCP-client OAuth, Clerk upstream). |
| `/api/...` | Hono app (`src/api/`) — config CRUD + Google account linking, behind Clerk session auth. |
| everything else | TanStack Start UI (`app/`). |

### Two independent auth systems

1. **MCP-client OAuth (who is calling the gateway).** MCP clients do OAuth 2.1 against the gateway; Clerk is the upstream identity provider. The minted MCP token encrypts the user's identity (`Props`: userId, email, …). This is the standard MCP auth handshake.
2. **Per-config Google OAuth (which Google account the endpoint acts as).** A separate flow under the Clerk browser session at `/api/google-auth/*`. The user clicks **Connect Google account**, consents at Google, and the gateway stores an **AES‑256‑GCM–encrypted refresh token** in KV. This is what actually grants access to Gmail/Drive/etc.

Keeping these separate means *your users authenticate to the gateway with Clerk*, while *each endpoint is bound to a specific Google account* you connect once.

### Slug → config → Google token (how a tool call resolves)

```
MCP client → /mcp/<slug>  (Bearer MCP token)
  └─ server.ts: strip slug, set X-Config-Slug header
       └─ oauthProvider verifies token → Props (userId)
            └─ MyMCP Durable Object: onConnect() captures the slug from the header
                 └─ tool handler: ctx.getService("<service>")
                      └─ load config (KV: cfg:<userId>:<slug>); assert service enabled
                      └─ load + decrypt refresh token (KV: gtok:<userId>:<slug>)
                      └─ refresh a Google access token
                      └─ call the Google REST API (fetch + Bearer) → format result
```

The slug is **not** known when the Durable Object first initializes, so **all tools are registered up front** and each one **gates at call time** (`getGoogleService` throws if the service isn't enabled for the resolved config, or if no Google account is connected). The single primitive every tool uses is `getGoogleService(env, userId, slug, service)` in `src/mcp/google-service.ts` — the TypeScript equivalent of the Python project's `@require_google_service` decorator.

### Storage

- **`WS_KV`** — app data:
  - `cfg:<userId>:<slug>` → `GoogleConfigRecord` `{ slug, displayName, enabledServices[], googleAccountEmail?, googleAccountSub?, … }`
  - `gtok:<userId>:<slug>` → token record with the **encrypted** refresh token
- **`OAUTH_KV`** — internal state for `@cloudflare/workers-oauth-provider`.
- **Durable Object `MyMCP`** — one instance per MCP session; holds the per-session slug and the live MCP server.

### Code map

```
src/
  server.ts            # URL dispatch (entrypoint / wrangler main)
  mcp/
    mcp-app.ts         # MyMCP Durable Object; registers all 12 modules; onConnect slug capture
    google-service.ts  # getGoogleService() + ToolContext + shared googleApiFetch()
    scopes.ts          # service → OAuth scope map
    tools/<service>.ts # one module per Google service, exporting register(server, ctx)
  api/
    index.ts           # Hono app: /configs CRUD (Clerk session auth)
    google-auth.ts     # /google-auth/* : Google account connect / status / disconnect
  storage.ts           # GoogleConfigRecord, token CRUD, AES-GCM encryption, slug rules
  clerk-handler.ts     # MCP-client OAuth (Clerk upstream)
app/                   # TanStack Start UI (config list / create / edit + connect-account)
docs/                  # port plan, source analysis, parity gaps
```

---

## Tool inventory

| Service | Module | Tools |
| --- | --- | ---: |
| Gmail | `gmail` | 14 |
| Calendar | `gcalendar` | 7 |
| Drive | `gdrive` | 16 |
| Docs | `gdocs` | 20 |
| Sheets | `gsheets` | 14 |
| Slides | `gslides` | 7 |
| Forms | `gforms` | 6 |
| Tasks | `gtasks` | 6 |
| Chat | `gchat` | 6 |
| Contacts | `gcontacts` | 8 |
| Search | `gsearch` | 2 |
| Apps Script | `gappsscript` | 15 |
| **Total** | | **121** |

Some tools have reduced behavior on the Workers runtime (e.g. PDF/Office-XML text extraction, Gmail batch HTTP) — they still exist and return a clear message. See [`docs/parity-gaps.md`](docs/parity-gaps.md).

---

## Setting up the Google OAuth client (required)

The per-config "Connect Google account" flow needs **your own Google OAuth client** (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`). Without it, the Connect button bounces to a Google "invalid client" error. Steps:

### 1. Pick / create a Google Cloud project
[Google Cloud Console](https://console.cloud.google.com) → create or select a project (this project *owns the app*; it does not have to belong to the Google accounts you connect).

### 2. Enable the APIs you'll use
APIs & Services → **Library** → enable the APIs for the services you plan to expose. With `gcloud`:

```bash
gcloud services enable \
  gmail.googleapis.com calendar-json.googleapis.com drive.googleapis.com \
  docs.googleapis.com sheets.googleapis.com slides.googleapis.com \
  forms.googleapis.com tasks.googleapis.com chat.googleapis.com \
  people.googleapis.com script.googleapis.com customsearch.googleapis.com \
  --project=<PROJECT_ID>
```

### 3. Configure the OAuth consent screen
APIs & Services → **OAuth consent screen**:
- **User type:** *Internal* (any user in your Google Workspace org — simplest, no test-user list) or *External* (any Google account, but in **Testing** mode only listed test users can consent).
- Fill in app name, support email, developer email.
- The Google Workspace scopes are **"sensitive"/"restricted"**. In **Testing** mode they work for **test users** (and for *External* apps, up to ~100 logins) **without** Google verification — fine for personal/team use. Going public to arbitrary users requires Google's verification review.
- **External + Testing:** add every Google account you intend to connect under **Test users**.

### 4. Create the OAuth client (Web application)
APIs & Services → **Credentials** → **Create credentials → OAuth client ID** → **Web application**:
- **Authorized redirect URI:** `https://<your-host>/api/google-auth/callback`
  - e.g. `https://workspace-mcp.rockyshoreslabs.io/api/google-auth/callback`
  - ⚠️ Google only allows `http://` for `localhost` / `127.0.0.1`. **All other hosts must be `https://`.** For local dev behind an HTTPS tunnel, register the tunnel's callback URL (and re-register if the tunnel URL changes).
- Click **Create**, then copy the **Client ID** and **Client secret**.

### 5. Wire the credentials in
```env
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```
(local `.env.local`) or as Worker secrets for deployment (see below).

### Extra setup for two services (optional)
- **Google Search (`gsearch`)** uses the **Programmable Search Engine** — an *API-key* product, not OAuth. Create a search engine at [programmablesearchengine.google.com](https://programmablesearchengine.google.com) (copy its **engine ID** / `cx`) and an **API key** scoped to the Custom Search API, then set `GOOGLE_PSE_API_KEY` and `GOOGLE_PSE_ENGINE_ID`.
- **Google Chat (`gchat`)** requires a **Chat app configuration** in the project (APIs & Services → Google Chat API → **Configuration**) even for user-credential calls; without it, Chat calls return `Chat app not found`.

---

## Secrets / environment

| Variable | Purpose |
| --- | --- |
| `CLERK_CLIENT_ID` / `CLERK_CLIENT_SECRET` | Clerk OAuth app (MCP-client OAuth) |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | `@clerk/backend` (verify sessions/JWTs) |
| `CLERK_FRONTEND_API` | e.g. `https://<subdomain>.clerk.accounts.dev` |
| `VITE_CLERK_PUBLISHABLE_KEY` | client-side Clerk (baked at build time) |
| `COOKIE_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | the Google OAuth client created above |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` — encrypts stored Google refresh tokens |
| `GOOGLE_PSE_API_KEY` / `GOOGLE_PSE_ENGINE_ID` | only for `gsearch` |

---

## Local development

```bash
bun install
cp .env.example .env.local   # fill in Clerk + Google + cookie/token keys
bun run dev                  # http://localhost:8788
```

- Open `http://localhost:8788`, sign in, create a config, pick services, **Connect Google account**.
- The Connect/sign-in flows redirect through Google/Clerk, so your callback URLs must be registered (see step 4). To test on a real HTTPS origin locally, expose the dev server with a tunnel and register that tunnel's callback URLs in both Google and Clerk.
- Scripts: `bun run dev`, `bun run build`, `bun run type-check`, `bun run lint`, `bun run deploy`.

## Deployment (Cloudflare)

```bash
# 1. Create KV namespaces and put the ids in wrangler.jsonc
wrangler kv namespace create workspace-mcp-oauth-kv   # → binding OAUTH_KV
wrangler kv namespace create workspace-mcp-ws-kv      # → binding WS_KV

# 2. Set the route / custom domain in wrangler.jsonc

# 3. Set Worker secrets (all of the above except VITE_* which is build-time)
wrangler secret put CLERK_CLIENT_ID
# … repeat for each secret …

# 4. Build + deploy
bun run deploy
```

After deploying, register the production callbacks:
- **Clerk OAuth app** → add `https://<host>/callback`
- **Google OAuth client** → add `https://<host>/api/google-auth/callback`

## Connecting an MCP client

Each config exposes:
- `https://<host>/mcp/<slug>` — Streamable HTTP (preferred)
- `https://<host>/sse/<slug>` — SSE (deprecated)

Example (Claude Desktop / Cursor / Windsurf):
```json
{
  "mcpServers": {
    "my-workspace": {
      "command": "npx",
      "args": ["mcp-remote", "https://<host>/mcp/<slug>"]
    }
  }
}
```
The client runs the OAuth handshake (Clerk) on first connect, then the tools act as the Google account linked to `<slug>`.

## License

Apache 2.0 (see [LICENSE](LICENSE)). Derived from [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (MIT).
