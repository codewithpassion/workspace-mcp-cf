# Architecture Analysis: workspace-mcp-CF → Google Workspace MCP Gateway

Root: `/home/roboto/devel/workspace-mcp-CF`  
Date: 2026-06-27

---

## 1. `src/server.ts` — URL Dispatch

**File:** `src/server.ts:1-49`

### Regex matchers
```typescript
// src/server.ts:7-8
const MCP_SLUG_RE = /^\/(mcp|sse)\/([^/]+)(\/.*)?$/;
const OAUTH_DIRECT_RE = /^\/(authorize|callback|register|token|\.well-known)/;
```

### MCP slug routing (lines 18–33)
```typescript
const mcpMatch = url.pathname.match(MCP_SLUG_RE);
if (mcpMatch) {
  const [, transport, slug, rest] = mcpMatch;          // slug extracted from group 2
  const rewritten = new URL(request.url);
  rewritten.pathname = `/${transport}${rest ?? ""}`;   // strip slug from path
  const headers = new Headers(request.headers);
  headers.set("X-Config-Slug", slug);                  // slug communicated via header
  const forwarded = new Request(rewritten, { method, headers, body, redirect:"manual" });
  const res = await oauthProvider.fetch(forwarded, env, ctx);
  return wrapOAuthResponse(res, forwarded);
}
```

The slug is **stripped from the URL path** and **injected as the `X-Config-Slug` header** on the forwarded request. This is the **only** mechanism that carries slug identity into the OAuth provider and ultimately into the DO.

### Route table
| Pattern | Handler | Where defined |
|---|---|---|
| `/(mcp\|sse)/<slug>(/...)?` | `oauthProvider.fetch(rewritten)` | `server.ts:19-33` |
| `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*` | `oauthProvider.fetch(request)` | `server.ts:35-38` |
| `/api/...` | `apiApp.fetch(stripped)` | `server.ts:40-45` (strips `/api` prefix before forwarding) |
| everything else | `startHandler.fetch(request)` | `server.ts:47` |

**Note on `/api/` stripping:** `src/server.ts:42` strips the `/api` prefix — so routes in `src/api/index.ts` are mounted at path-relative-to-root-minus-`/api`. A route declared as `apiApp.get("/configs", ...)` handles `GET /api/configs`.

### `wrapOAuthResponse` (mcp-app.ts:37–92)
Two transformations on OAuth provider responses:
1. On `/.well-known/oauth-authorization-server` GET: replaces `http://` with `https://` in JSON body (tunnel/proxy support).
2. On any `401`: enriches `WWW-Authenticate` header with `resource_metadata=` URL (RFC 9728 for MCP client discovery).

---

## 2. `src/mcp/mcp-app.ts` — MCP Server (DO)

**File:** `src/mcp/mcp-app.ts:1-92`

### Class declaration
```typescript
// src/mcp/mcp-app.ts:7
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "Workspace MCP", version: "1.0.0" });

  async init() {
    // Pre-initialize tool request handlers before the transport connects.
    (this.server as unknown as { setToolRequestHandlers(): void }).setToolRequestHandlers();
    // ← EXTENSION POINT: register tools here with this.server.tool(...)
  }
}
```

**Type parameters:** `McpAgent<Env, State, Props>`:
- `Env` — Cloudflare Workers bindings (KV, DO, secrets) — see `worker-configuration.d.ts:9-19`
- `State = Record<string, never>` — DO SQLite state (currently empty; must be widened to add `slug`)
- `Props` — user identity encrypted in MCP token: `{ userId, sessionId, email?, firstName?, lastName?, imageUrl? }` — `src/utils.ts:92-99`

### Tool registration extension point
`init()` is the **sole** lifecycle hook called once per DO instance when the MCP session is established. Register tools here:
```typescript
async init() {
  (this.server as unknown as { setToolRequestHandlers(): void }).setToolRequestHandlers();
  this.server.tool("gmail_list", schema, async (args) => { /* use this.props, this.env, this._slug */ });
}
```
`this.server` is a `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. `this.props` holds user identity. `this.env` holds `OAUTH_KV`, `MCP_OBJECT`, and all secrets.

### DO routing
```typescript
// src/mcp/mcp-app.ts:21-30
export const oauthProvider = new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),  // legacy
    "/mcp": MyMCP.serve("/mcp"),     // primary (Streamable HTTP)
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: ClerkHandler as unknown as ExportedHandler,
  tokenEndpoint: "/token",
});
```

`MyMCP.serve("/mcp")` (from `agents/mcp/index.d.ts:134-141`) creates a handler that:
1. Reads `mcp-session-id` header from the request.
2. Builds a DO stub: `env.MCP_OBJECT.get(env.MCP_OBJECT.idFromName("streamable-http:<sessionId>"))` (inferred from `getSessionId()` naming scheme noted in `agents/mcp/index.d.ts:106`).
3. Forwards the full request (including `X-Config-Slug` header) to the DO stub.

The `@cloudflare/workers-oauth-provider` also verifies the Bearer token and extracts `props` from it, making them available via `McpAgent.updateProps(props)` before `init()` is called.

### Lifecycle methods available for override
From `agents/mcp/index.d.ts:115-119`:
```typescript
onStart(props?: Props): Promise<void>;   // called when DO wakes; props injected here
onConnect(conn: Connection, { request: req }: ConnectionContext): Promise<void>; // per-connection
```

**Critical:** `onConnect` receives the `req` (the HTTP request that established the connection), which carries `X-Config-Slug`. This is where the slug should be captured. `onStart` is called before `init()`.

---

## 3. OAuth Layer

### Files
- `src/clerk-handler.ts` — Hono app handling `/authorize` (GET+POST), `/callback`, `/.well-known/oauth-protected-resource`
- `src/workers-oauth-utils.ts` — stateless helpers: CSRF, state KV storage, cookie crypto, HTML approval dialog
- `src/utils.ts` — `Props` type, `getUpstreamAuthorizeUrl`, `fetchUpstreamAuthToken`

### `Props` type (src/utils.ts:92-99)
```typescript
export type Props = {
  userId: string;
  sessionId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  [key: string]: unknown; // index signature for McpAgent compatibility
};
```
Props are minted once at `/callback` time and encrypted into the MCP access token. They are immutable for the token lifetime. **The config slug is NOT in Props** — it's discovered at connection time from `X-Config-Slug`.

### Clerk MCP-client OAuth flow
1. MCP client → `GET /authorize` → `clerk-handler.ts:84` → shows approval dialog (or skips if already approved)
2. User approves → `POST /authorize` → `clerk-handler.ts:119` → creates KV state, sets cookies, redirects to `CLERK_FRONTEND_API/oauth/authorize`
3. Clerk authenticates user → redirects to `GET /callback` → `clerk-handler.ts:216`
4. `/callback` exchanges code for `id_token`, verifies JWT (`verifyToken`), extracts user claims
5. Calls `c.env.OAUTH_PROVIDER.completeAuthorization({ props, ... })` → mints MCP token → redirects MCP client

**Where to add Google OAuth WITHOUT breaking this flow:**

The Clerk MCP-client OAuth uses paths: `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*`. All go through `oauthProvider.fetch()` → `ClerkHandler`.

Google OAuth for connecting a Google account is a **completely separate flow** operating at the browser/UI level using the **Clerk session** (not MCP tokens). It should be:

```
GET  /api/google-auth/start/:slug   → src/api/index.ts  (Clerk session auth)
GET  /api/google-auth/callback      → src/api/index.ts  (Clerk session auth)
DELETE /api/google-auth/:slug       → src/api/index.ts  (Clerk session auth)
```

This keeps the two OAuth systems fully separate:
- **Clerk OAuth (MCP):** `/authorize` → Clerk → `/callback` → MCP token
- **Google OAuth (account link):** `/api/google-auth/start` → Google → `/api/google-auth/callback` → refresh token in KV

Secrets needed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (add to `wrangler.jsonc` comments and `worker-configuration.d.ts`).

The `/api/google-auth/callback` state parameter must encode (userId, slug) to know which config to update after Google redirects back.

---

## 4. Storage (`src/storage.ts`)

**File:** `src/storage.ts:1-80`

### Current schema
```typescript
export interface ConfigRecord {         // src/storage.ts:1-8
  slug: string;
  displayName: string;
  apiKey: string;           // ← REMOVE for Google model
  baseUrl?: string;         // ← REMOVE for Google model
  createdAt: string;
  updatedAt: string;
}
```

### Current KV scheme
```typescript
// src/storage.ts:42-45
export const cfgKey = (userId: string, slug: string) => `ws:cfg:${userId}:${slug}`;
const userPrefix = (userId: string) => `ws:cfg:${userId}:`;
```
All stored in `env.OAUTH_KV` (binding: `OAUTH_KV`, id: `74ef76f891b24987a6230480e8a454da`).

### Required changes for Google model

**New `ConfigRecord`:**
```typescript
export interface GoogleConfigRecord {
  slug: string;
  displayName: string;
  // Enabled Google services:
  enabledServices: GoogleService[];   // e.g. ["gmail", "gdrive", "gcalendar", ...]
  // Linked Google account info (null if not connected):
  googleAccountEmail?: string;
  googleAccountId?: string;
  createdAt: string;
  updatedAt: string;
}
export type GoogleService = "gmail" | "gdrive" | "gcalendar" | "gdocs" | "gsheets" | "gslides" | "gforms" | "gcontacts" | "gtasks" | "gchat" | "gappsscript";
```

**New KV key for Google refresh tokens:**
```
ws:google-token:<userId>:<slug>   → encrypted refresh token JSON
```

**Storage strategy options:**
- Option A: Same `OAUTH_KV` namespace with new key prefix `ws:google-token:` — simple, no wrangler.jsonc change
- Option B: New `WORKSPACE_KV` namespace — cleaner separation, requires new namespace in `wrangler.jsonc`

The token value should be AES-GCM encrypted (using `COOKIE_ENCRYPTION_KEY` or a new `GOOGLE_TOKEN_ENCRYPTION_KEY`) before KV storage. KV limit is 25MB per value — fine for a token JSON.

**Token record shape:**
```typescript
interface GoogleTokenRecord {
  refreshToken: string;    // encrypted at rest with AES-GCM
  accessToken?: string;    // cached (short-lived, optional)
  expiresAt?: number;      // unix ms
  scope: string;
}
```

---

## 5. JSON API (`src/api/index.ts`)

**File:** `src/api/index.ts:1-124`

### Current structure
```typescript
const apiApp = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
apiApp.use("*", clerkAuthMiddleware);   // src/api/index.ts:18-41
// routes at src/api/index.ts:60-122:
//   GET  /configs
//   POST /configs
//   GET  /configs/:slug
//   PATCH /configs/:slug
//   DELETE /configs/:slug
```

### Extension points for Google Workspace

**Approach 1 — In-file:** Add new route groups directly to `apiApp` in `src/api/index.ts`.

**Approach 2 — Sub-app:** Create `src/api/google-auth.ts` as a new Hono app, mount it into `apiApp` with `apiApp.route("/google-auth", googleAuthApp)`.

New routes needed:
```
GET  /google-auth/start/:slug     → start Google OAuth (redirect user to Google)
GET  /google-auth/callback        → Google OAuth callback (exchange code, store token)
DELETE /google-auth/:slug         → disconnect Google account (delete token from KV)
GET  /google-auth/status/:slug    → check if connected (returns email + connected bool)
```

Also, the config endpoints must change to reflect new `GoogleConfigRecord` schema:
```
POST /configs        → body: { slug, displayName, enabledServices[] }  (no apiKey/baseUrl)
PATCH /configs/:slug → body: { displayName?, enabledServices? }
```

**Existing Clerk auth middleware** at `src/api/index.ts:18-41` handles all `/api/*` routes automatically — no changes needed there.

**Google callback state parameter** must encode `userId` + `slug`. Options:
- KV-backed state token (same pattern as `workers-oauth-utils.ts:265-278`)
- Signed JWT in the state query parameter

---

## 6. UI (`app/` TanStack Start)

### Auth gate
`app/routes/app/route.tsx:5-7` — `beforeLoad: () => requireAuthFn()` gates all `/app/*` routes.

`app/lib/auth.ts:5-11` — `requireAuthFn` checks Clerk session; redirects to `/sign-in` if not authenticated.

### Config list (`app/routes/app/configs/index.tsx`)
Currently shows: Slug, Display name, MCP URL, API key, Actions.

**Changes for Google model:**
- Remove "API key" column
- Add "Google Account" column (email or "Not connected" badge)
- Add "Enabled Services" column (badge list)
- "Edit" button navigates to `$slug.tsx`

### Config create (`app/routes/app/configs/new.tsx`)
Currently has fields: slug, displayName, apiKey, baseUrl.

**Changes for Google model:**
- Remove `apiKey` and `baseUrl` fields
- Add `enabledServices` multi-select/checkboxes (one per Google service)
- After creation, show "Connect Google Account" button

### Config edit (`app/routes/app/configs/$slug.tsx`)
Currently: displayName, rotate apiKey, baseUrl. Plus delete dialog.

**Changes for Google model:**
- Remove apiKey rotation + baseUrl
- Add: "Connected Google Account" section with email display + "Disconnect" button
- Add: "Connect Google Account" button (links to `/api/google-auth/start/:slug`) when not connected
- Add: Service feature toggles (checkboxes for each `GoogleService`)
- Keep delete dialog

### `app/lib/api.ts`
Current types: `ConfigRecord`, `CreateConfigInput`, `UpdateConfigInput`. All must be updated for the new schema. New API wrapper methods for Google auth endpoints.

### New UI routes needed
- No new route files required — the connect/disconnect flow uses redirects through `/api/google-auth/` endpoints
- OAuth callback from Google redirects back to `/api/google-auth/callback` (server-side, no UI needed)
- After successful connection, redirect to `/app/configs/<slug>`

---

## 7. Config & Dependencies

### `wrangler.jsonc`
```jsonc
// Current - src/wrangler.jsonc:23-54
"migrations": [{ "new_sqlite_classes": ["MyMCP"], "tag": "v1" }],
"durable_objects": { "bindings": [{ "class_name": "MyMCP", "name": "MCP_OBJECT" }] },
"kv_namespaces": [{ "binding": "OAUTH_KV", "id": "74ef76f891b24987a6230480e8a454da" }]
```

**Required additions:**
1. New KV namespace for Google tokens (if using Option B above):
   ```jsonc
   { "binding": "WORKSPACE_KV", "id": "<new-id>" }
   ```
2. New secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`
3. If DO state type changes: new migration tag (e.g., `"tag": "v2"`) — but changing `Record<string,never>` to `{slug: string}` and storing in SQLite requires a new migration only if the DO schema changes; in-memory fields don't.

### `package.json` — Available dependencies
```json
"@cloudflare/workers-oauth-provider": "^0.0.13"   // OAuth 2.1 server
"@modelcontextprotocol/sdk": "1.20.2"              // MCP tools API
"agents": "^0.2.19"                                // McpAgent / Agent / DurableMCP
"hono": "^4.10.4"                                  // API routing
"zod": "^3.25.76"                                  // validation
"@clerk/backend": "^2.21.0"                        // session verification
```

No additional npm packages needed for the core Google OAuth flow (uses native `fetch`). For Google API calls, also native `fetch` — no SDK needed (the reference repo `tmp/google_workspace_mcp` uses plain HTTP).

### TypeScript strictness (`tsconfig.json:37`)
```json
"strict": true
```
All strict checks are on. This means:
- `noImplicitAny` — must type everything explicitly
- `strictNullChecks` — must handle null/undefined
- No implicit `any` parameters or return types

**Biome linter (`biome.json:25-28`):**
```json
"linter": { "enabled": true, "rules": { "recommended": true } }
```
Biome v2 "recommended" rules do **not** include a hard ban on `any` (unlike `suspicious/noExplicitAny` which must be explicitly enabled). So `any` with explicit annotation is lintable but won't auto-fail. Stick to explicit types for safety.

### `vite.config.ts`
```typescript
// vite.config.ts:16
cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false })
```
`remoteBindings: false` avoids multi-account prompt during dev. All bindings are local (KV via `.wrangler/state/`).

---

## 8. Tool → Config Resolution: Full Trace

This is the critical path for how a tool knows which Google account/config to use.

### Step-by-step request lifecycle for `GET /mcp/my-workspace`

1. **`server.ts:18-33`**: `MCP_SLUG_RE` matches → `slug = "my-workspace"`.
2. **`server.ts:22`**: URL rewritten to `/mcp` (slug stripped).
3. **`server.ts:24`**: `headers.set("X-Config-Slug", "my-workspace")`.
4. **`server.ts:31`**: `oauthProvider.fetch(forwarded, env, ctx)` called.
5. **`@cloudflare/workers-oauth-provider`**: Verifies Bearer token → decrypts `Props` `{ userId: "user_xxx", sessionId: "sess_yyy", email: "...", ... }`.
6. **`oauthProvider` → `MyMCP.serve("/mcp")`** (`mcp-app.ts:24`): reads `mcp-session-id` header, builds DO stub, forwards request (with `X-Config-Slug` still in headers).
7. **DO (`MyMCP`) wakes**: `onStart(props)` called → `this.props = { userId, sessionId, email, ... }`.
8. **DO `init()` called** (`mcp-app.ts:13-18`): currently only calls `setToolRequestHandlers()`.

### Slug availability in the DO

The `X-Config-Slug` header is present on the forwarded request, but currently **nothing reads it**. There are two extension approaches:

**Approach A — `onConnect` override (recommended):**
```typescript
// Override in MyMCP
async onConnect(conn: Connection, { request }: ConnectionContext): Promise<void> {
  const slug = request.headers.get("X-Config-Slug");
  if (slug) this._slug = slug;
  await super.onConnect(conn, { request });
}
private _slug?: string;
```
`onConnect` is called for each new WebSocket/HTTP connection and has `request` in scope.

**Approach B — DO SQLite state:**
Change state type from `Record<string, never>` to `{ slug?: string }` and call `this.setState({ slug })` in `onConnect`. This persists across DO hibernation (important if the DO can sleep mid-session).

**Approach C — `getCurrentAgent()` in tool handler:**
From `agents/dist/index-DFqsR7mb.d.ts:154-161`, `getCurrentAgent()` returns `{ agent, connection, request }`. If `request` is the streaming HTTP request (which has `X-Config-Slug`), a tool handler can call `getCurrentAgent().request?.headers.get("X-Config-Slug")`. This avoids needing to store it.

### Tool handler pattern for Google config/token lookup

```typescript
// In MyMCP.init():
this.server.tool("gmail_list_messages", gmailListSchema, async (args) => {
  const userId = this.props!.userId;
  const slug = this._slug!;                              // captured from X-Config-Slug
  
  const config = await loadGoogleConfig(this.env, userId, slug);
  if (!config) throw new Error(`Config "${slug}" not found`);
  if (!config.enabledServices.includes("gmail")) throw new Error("Gmail not enabled");
  
  const tokenRecord = await loadGoogleToken(this.env, userId, slug);
  if (!tokenRecord) throw new Error("Google account not connected");
  
  const accessToken = await refreshGoogleAccessToken(
    tokenRecord.refreshToken,    // decrypt then use
    this.env.GOOGLE_CLIENT_ID,
    this.env.GOOGLE_CLIENT_SECRET,
  );
  
  // Call Google API
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { content: [{ type: "text", text: JSON.stringify(await resp.json()) }] };
});
```

---

## 9. Reference Repo: `tmp/google_workspace_mcp`

Structure (Python/FastMCP):
```
gdrive/drive_tools.py         gcontacts/contacts_tools.py
gdocs/docs_tools.py           gforms/forms_tools.py
gsheets/sheets_tools.py       gslides/slides_tools.py
gcalendar/ (implied)          gmail/ (implied)
gtasks/                       gchat/
gappsscript/apps_script_tools.py
core/config.py                core/storage.py
```

Google services represented: Drive, Docs, Sheets, Slides, Forms, Contacts, Tasks, Chat, Apps Script, Calendar, Gmail, Search.

Each Python tool module directly maps to a `GoogleService` enum value and a set of `this.server.tool()` registrations in TypeScript.

---

## 10. Constraints Summary

| Constraint | Detail |
|---|---|
| DO state type | Currently `Record<string, never>`; must widen to store `slug` (Approach B) or use in-memory field (Approach A) |
| `Props` sealed at auth time | Cannot include `slug` — always comes from `X-Config-Slug` header at connection time |
| TypeScript strict | `noImplicitAny` + `strictNullChecks` — all types must be explicit; use `Props["userId"]` not `any` |
| No Biome `noExplicitAny` | Biome recommended rules don't hard-ban `any` — but stick to typed code for correctness |
| KV limits | 25MB value, 512B key, 1000 ops/second burst — fine for token storage |
| DO uniqueness | One DO per `mcp-session-id` — slug is session-scoped, not shared across sessions |
| `wrangler types` gotcha | Re-running `wrangler types` drops secret declarations from `worker-configuration.d.ts` — re-add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` manually |
| Migration required | If DO SQLite state schema changes, add new `migrations` entry in `wrangler.jsonc` |
| `/api/` prefix stripping | `server.ts:42` strips `/api` before forwarding — API routes in `src/api/index.ts` are path-relative (no `/api` prefix) |
| Google OAuth redirect URI | Must be registered in Google Cloud Console; e.g., `https://<host>/api/google-auth/callback` |
| `remoteBindings: false` | Dev uses local KV/DO state in `.wrangler/state/` — no remote state available locally |

