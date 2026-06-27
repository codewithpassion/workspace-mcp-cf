# Google Workspace MCP — Python → TypeScript Port Plan

**Status:** Approved, pre-implementation
**Date:** 2026-06-27
**Source:** `tmp/google_workspace_mcp` — [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) v1.22.0 (FastMCP / Python)
**Target:** this repo — multi-tenant MCP gateway on Cloudflare Workers (TanStack Start + Hono + Durable MCP + Clerk)

Detailed source/target analysis lives in [`docs/analysis/`](./analysis/):
- `analysis-py-core.md` — Python auth / `@require_google_service` / scopes / service-selection
- `analysis-py-tools.md` — **the full 121-tool inventory; this is the acceptance checklist**
- `analysis-ts-scaffold.md` — TS extension points, request lifecycle, constraints

---

## 1. Goal

Port the comprehensive Google Workspace MCP server (121 tools across 12 Google services) onto the existing Cloudflare Workers gateway, so that:

- Each Clerk-authenticated user can create **multiple MCP endpoints**, one per Google account.
- Each endpoint (`/mcp/<slug>`) links to **one Google account** (via per-config Google OAuth) and exposes a **user-selected subset of services** (core, calendar, gmail, …).
- Endpoint URLs are unique per user (existing slug uniqueness already enforced per-user; see §4).
- Config is stored in KV.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Google auth model | **Clerk stays** for user identity + MCP-client OAuth. Each config links a Google account via its **own** Google OAuth 2.1 flow at the UI/session layer. Encrypted refresh tokens in a new KV. |
| 2 | Service scope | **All 12 services** (full parity, 121 tools). |
| 3 | Local validation w/o Google secret | **Wire real Google OAuth**; OAuth *completion* untested until a secret is supplied. Config-management **UI stays locally testable** (Clerk keys present in `.env.local`). |
| 4 | Config model | **Replace** the generic `{slug, apiKey, baseUrl}` with a Google config model `{slug, displayName, enabledServices[], googleAccountEmail?}`. New KV namespace. |

## 3. The load-bearing assumption (prove FIRST)

The whole design depends on this chain working at runtime:

```
/mcp/<slug>  →  server.ts sets X-Config-Slug header  →  oauthProvider.fetch
   →  MyMCP.serve("/mcp")  →  Durable Object  →  tool handler reads slug
   →  loadGoogleConfig(userId, slug)  →  loadGoogleToken(userId, slug)  →  Google API
```

Nothing in the scaffold reads `X-Config-Slug` today; the DO routing and the timing of slug availability relative to `init()` are **inferred, not proven** (see `analysis-ts-scaffold.md` §2, §8). Two things must be verified before building 121 tools:

1. **Does the slug survive the hop and is it readable at tool-call time?** (Approaches A `onConnect` field / B DO SQLite state / C `getCurrentAgent().request` — pick the one that actually works.)
2. **Is the slug available when `init()` runs?** This decides the registration strategy:
   - If **yes** → register only the enabled services' tools in `init()`.
   - If **no** → register all tools in `init()` and **gate at call time** (throw if service not enabled for the resolved config).

→ **Phase 0 is a spike**, not tool-building. See §9.

## 4. Config model & KV design

```ts
export type GoogleService =
  | "gmail" | "gcalendar" | "gdrive" | "gdocs" | "gsheets" | "gslides"
  | "gforms" | "gtasks" | "gchat" | "gcontacts" | "gsearch" | "gappsscript";

export interface GoogleConfigRecord {
  slug: string;
  displayName: string;
  enabledServices: GoogleService[];
  googleAccountEmail?: string;   // set after Google OAuth completes
  googleAccountSub?: string;     // Google 'sub' claim, stable account id
  createdAt: string;
  updatedAt: string;
}

interface GoogleTokenRecord {
  refreshToken: string;   // AES-GCM encrypted at rest
  scope: string;
  accountEmail: string;
  accountSub: string;
  updatedAt: string;
}
```

**KV layout** — new namespace `WS_KV` (keep `OAUTH_KV` for the OAuth provider's own state):
- `cfg:<userId>:<slug>` → `GoogleConfigRecord`
- `gtok:<userId>:<slug>` → encrypted `GoogleTokenRecord`

Slug rules unchanged (`^[a-z0-9][a-z0-9-]{1,62}$`, reserved words). Uniqueness is per-user (key includes `userId`); the public URL `/mcp/<slug>` is therefore unique within a user's namespace. **Open question for global uniqueness** if slugs must be globally unique across users → see §13.

Encryption: AES-GCM via WebCrypto, key from a new secret `GOOGLE_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`). Reuse the crypto helpers' style from `workers-oauth-utils.ts`.

## 5. Google OAuth flow (per-config account linking)

Completely separate from the Clerk MCP OAuth (which owns `/authorize`, `/callback`, `/register`, `/token`, `/.well-known/*`). The Google flow runs under the **Clerk browser session** via `/api/*`:

```
GET    /api/google-auth/start/:slug   → build Google consent URL (offline, prompt=consent,
                                         scopes = union of enabledServices' scopes), redirect
GET    /api/google-auth/callback      → exchange code, fetch userinfo (email+sub),
                                         encrypt+store refresh token, update config, redirect to /app/configs/:slug
GET    /api/google-auth/status/:slug  → { connected, email? }
DELETE /api/google-auth/:slug         → delete token, clear config account fields
```

State param encodes `(userId, slug)` (KV-backed, same pattern as `workers-oauth-utils.ts`). Redirect URI: `http://localhost:8788/api/google-auth/callback` (dev) / `https://<host>/api/google-auth/callback` (prod) — must be registered in Google Cloud Console.

New secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`.

## 6. The service-injection helper (`@require_google_service` equivalent)

Single foundation primitive every tool uses:

```ts
// Resolves the config, ensures the service is enabled, refreshes a Google access token,
// returns an authenticated fetch-based client for the given Google API.
async function getGoogleService(
  env: Env, userId: string, slug: string, service: GoogleService,
): Promise<{ accessToken: string; accountEmail: string }>
```

- Loads `GoogleConfigRecord`; throws if missing or `service` not in `enabledServices`.
- Loads + decrypts `GoogleTokenRecord`; throws "Google account not connected" if absent.
- Refreshes access token via Google token endpoint (cache short-lived token in-memory on the DO).
- Tools call Google REST APIs directly with `fetch` + `Authorization: Bearer`. **No googleapis SDK** — the Python code already uses plain HTTP semantics and the Workers runtime has no Node google client.

This replaces the Python decorator's account resolution: in our model the account is fixed by `slug → config → linked Google account`, so **`user_google_email` is NOT a tool parameter** (see §7).

## 7. Systematic schema transforms (apply to all 121 tools)

1. **Drop `user_google_email`** from every tool's input schema. The Python inventory lists it as required on all 121 tools, but the account is determined by the config. (This mirrors the Python decorator removing `user_google_email` in OAuth 2.1 mode.)
2. Tool names preserved **verbatim** from the inventory (`search_gmail_messages`, `manage_event`, …) for client compatibility.
3. Params, types, defaults, and the **Google API method/path** must match `analysis-py-tools.md` — that table is the parity spec.
4. Zod schemas; explicit types (tsconfig `strict`). Avoid `any`.

## 8. Runtime-capability policy (decide up front)

Some Python tools rely on libraries/CPU the Workers runtime can't match. Policy: **attempt parity; if not achievable in-runtime, register the tool as a clearly-labeled stub** (returns a structured "not supported in this runtime: <reason>" message) and record a `TODO` — do **not** burn review cycles chasing the impossible. Candidates (confirm during porting):

| Tool(s) | Risk | Fallback |
|---|---|---|
| `get_drive_file_content`, `get_doc_content` (Office-XML/PDF extraction) | No pdfminer/zip-XML text extraction; CPU limits | Native-export path works; binary→ best-effort or stub for DOCX/XLSX/PPTX/PDF |
| `send_gmail_message`, `draft_gmail_message` (MIME multipart, inline images) | No `email.message`; must hand-build RFC822 + base64url | Implement plain + simple-attachment; inline-image CID best-effort |
| `get_*_content_batch`, `get_*_threads_batch` (Gmail batch HTTP) | No batch client | Sequential fetch with concurrency cap (document the change) |
| `get_doc_as_markdown`, `manage_doc_tab` markdown, `batch_update_doc` | Large conversion logic | Port incrementally; stub unsupported op subtypes with TODO |

Every stub still **counts as registered** for the completeness metric (§11) but is flagged in a `docs/parity-gaps.md` produced during implementation.

## 9. Phasing

Foundation must be **frozen** before any module fan-out, and validated on **one vertical slice** before scaling.

### Phase 0 — Foundation + spike + vertical slice (sequential, single forge)
0a. **Slug spike**: debug tool echoing resolved `slug` + loaded config; connect via MCP Inspector locally; confirm §3 (which approach works, slug-at-init? answer). Output the registration strategy decision.
0b. **Config model + KV**: new `WS_KV` namespace in `wrangler.jsonc`; rewrite `src/storage.ts` to `GoogleConfigRecord` + token store + AES-GCM crypto.
0c. **Google OAuth flow**: `/api/google-auth/*` routes (§5); secrets wired into `worker-configuration.d.ts`.
0d. **`getGoogleService` helper** (§6).
0e. **Vertical slice — Calendar (7 tools)**: includes reads + the complex `manage_event`. Verify the full pattern end-to-end (compiles, registered, parity-reviewed). This proves the per-module template.
0f. **UI minimal**: config create/edit with `enabledServices` checkboxes + "Connect Google account" / status / disconnect.

**Gate:** Phase 0 must pass type-check + build + lint, and the slug path must be proven, before Phase 1.

### Phase 1 — Module fan-out (parallel forge agents, one per module)
Each module → `src/mcp/tools/<service>.ts` exporting `register(server, ctx)`. Modules are disjoint files; the only shared touch-point is the registration index in `init()`, wired as one controlled integration step. Per-module units (counts = acceptance metric):

| Unit | Module | Tools |
|---|---|---|
| 1 | gmail | 14 |
| 2 | gdrive | 16 |
| 3 | gdocs | 20 |
| 4 | gsheets | 14 |
| 5 | gslides | 7 |
| 6 | gforms | 6 |
| 7 | gtasks | 6 |
| 8 | gchat | 6 |
| 9 | gcontacts | 8 |
| 10 | gsearch | 2 |
| 11 | gappsscript | 15 |
| (done in P0) | gcalendar | 7 |

Total **121**. (`gsearch` also needs `GOOGLE_PSE_API_KEY` + `GOOGLE_PSE_ENGINE_ID`.)

### Phase 2 — UI completion + integration
Full config UI polish, services multi-select UX, account-connected badges, list columns; registration index wiring verified for all modules.

### Phase 3 — Local validation
Run Worker locally; type-check/build/lint green; drive the config UI with Claude-in-Chrome (create/edit/delete endpoints, select services, see unique URLs, connect-account button reachable). Google OAuth *completion* deferred to when a secret is supplied.

## 10. Implementation orchestration (per the request)

- Each unit implemented by a **forge** subagent.
- After a unit reports done, an **adversarial reviewer** agent checks it against the exit criteria (§11).
- If the reviewer finds issues → a **fix** agent addresses them → **re-review**. **Max 5 cycles per unit**; if still failing, record in `docs/parity-gaps.md` and surface to the user.
- Module files are disjoint → safe parallel forge agents **after** the foundation is frozen.
- Idle/stale agents cleaned up between phases.

## 11. Review loop exit criteria (runtime is untestable without a Google secret)

A unit is **done** when ALL hold:
1. `bun run type-check` passes (whole project).
2. `bun run build` passes.
3. `bun run lint` passes.
4. **Parity**: every tool's name, params (minus `user_google_email`), defaults, and Google API method/path match `analysis-py-tools.md`; tool **count for the module matches** the inventory.
5. Runtime-impossible tools are stubbed per §8 and listed in `docs/parity-gaps.md` (not silently dropped).

"All features" = **121 tools registered, per-module counts matching, parity-reviewed, compiling** — explicitly NOT runtime-verified (no Google secret).

## 12. Secrets / env (summary)

Existing (present in `.env.local`): `CLERK_*`, `COOKIE_ENCRYPTION_KEY`.
New: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, and (for gsearch) `GOOGLE_PSE_API_KEY`, `GOOGLE_PSE_ENGINE_ID`. Add declarations to `worker-configuration.d.ts` (note: `wrangler types` drops them — re-add manually).

## 13. Open questions (non-blocking; sensible defaults chosen)

- **Slug uniqueness scope**: currently per-user. If global uniqueness across all users is required, switch the KV key to `cfg:<slug>` with an ownership field, or namespace the public URL by user. Default: keep per-user.
- **Token encryption key reuse**: use a dedicated `GOOGLE_TOKEN_ENCRYPTION_KEY` vs. reusing `COOKIE_ENCRYPTION_KEY`. Default: dedicated key.
- **gsearch** requires API-key creds (PSE), not OAuth — may be deferred if keys unavailable. Default: implement, stub if keys absent.
