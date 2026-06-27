# Phase 0 Findings — Slug Availability & Registration Strategy

**Date:** 2026-06-27  
**Status:** Decided, implementation complete (P0a–P0d)

---

## 1. The Load-Bearing Question

> Is `X-Config-Slug` available at `init()` time in the Durable Object?

**Answer: No.** `init()` is not available at tool-registration time.

---

## 2. Evidence (source-level proof from `node_modules/agents/dist/mcp/index.js`)

### Lifecycle order

```
agent.fetch(req)                          ← HTTP request arrives at DO
  └─ partyserver wakes DO
       └─ onStart(props)                  ← line 1196
            ├─ updateProps(props)         ← stores Clerk userId/email etc.
            ├─ await this.init()          ← TOOL REGISTRATION HAPPENS HERE
            │    (this._slug is undefined — request hasn't been seen yet)
            ├─ initTransport()
            └─ server.connect(transport)
  └─ WebSocket upgrade
       └─ onConnect(conn, {request: req}) ← line 1206
            (request carries X-Config-Slug ← available HERE)
```

### Why `X-Config-Slug` survives the hop

The `serve()` handler copies **all** original headers into the forwarded request
before calling `agent.fetch()` (lines 153–162 POST, 261–270 GET, 369–377 SSE):

```js
const existingHeaders = {};
request.headers.forEach((value, key) => { existingHeaders[key] = value; });
const req = new Request(request.url, { headers: {
    ...existingHeaders,              // ← ALL original headers, including X-Config-Slug
    [MCP_HTTP_METHOD_HEADER]: "POST",
    ...
} });
```

The library's own internal dispatch uses `MCP_HTTP_METHOD_HEADER` and `MCP_MESSAGE_HEADER`
from the **same header-copy block** as `X-Config-Slug`. If those were stripped, the library's
own routing would break. Therefore `X-Config-Slug` reaches `onConnect` **by the same
mechanism the library depends on** — the proof is structural.

### `onConnect` fires for every Streamable-HTTP request

Despite the TypeScript comment "Validates new WebSocket connections", `onConnect` handles
both SSE WebSocket upgrades AND Streamable-HTTP POST/GET requests (lines 1206–1232).
For Streamable-HTTP, `handlePostRequest` (tool calls) is invoked INSIDE `onConnect`,
so `this._slug` is set before any tool handler runs.

### Hibernation is not an issue

For Streamable-HTTP, each incoming request enters via `agent.fetch()` → `onConnect`.
After hibernation, `onStart` re-runs `init()` (slug unknown), but the very next request
re-enters `onConnect` and re-sets `this._slug` before the tool handler executes.
Every tool call is therefore guaranteed to see the correct slug.

---

## 3. Registration Strategy Decision

**DECISION: register-all-and-gate-at-call-time**

Because the slug is unknown at `init()`, tool handlers cannot be conditionally
registered based on `enabledServices`. Instead:

- All tools for all 12 services are registered unconditionally in `init()`.
- At call time, `ctx.getService(service)` calls `getGoogleService()` which:
  1. Loads `GoogleConfigRecord` from KV.
  2. Asserts `service ∈ enabledServices` — throws if not enabled.
  3. Loads and decrypts the Google refresh token — throws if not connected.
  4. Refreshes the access token and returns it.

**Known behavioral difference from Python:** All 121 tools are visible to every
MCP client regardless of which services are enabled for the config. Disabled tools
throw a descriptive error at call time rather than being absent from the tool list.
This is intentional and acceptable (see plan §3 note on registration strategy).

---

## 4. Implementation: Approach A (in-memory `_slug` field)

```typescript
// src/mcp/mcp-app.ts
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
    private _slug: string | undefined = undefined;

    override async onConnect(conn: Connection, ctx: ConnectionContext): Promise<void> {
        const slug = ctx.request.headers.get("X-Config-Slug");
        if (slug) this._slug = slug;
        await super.onConnect(conn, ctx);   // ← tool dispatch happens inside super
    }
}
```

**Why Approach A over Approach B (DO SQLite state):**
- Simpler: no state type change, no migration entry needed.
- Correct for hibernation: Streamable-HTTP re-enters `onConnect` on every request.
- Approach B (SQLite) would be redundant — the slug is re-injected on every request anyway.

---

## 5. Frozen ToolContext Interface

**This is the interface all 11 module agents build against. Do NOT change it without
updating all module files.**

```typescript
// src/mcp/google-service.ts
export type ToolContext = {
    /** Cloudflare Workers bindings — available at init() time. */
    env: Env;
    /** Returns the Clerk userId. Throws if unavailable. */
    getUserId(): string;
    /**
     * Returns the config slug for the active session.
     * Throws if called before onConnect (i.e., outside an active connection).
     */
    getSlug(): string;
    /**
     * Loads config, asserts service is enabled, decrypts refresh token,
     * refreshes Google access token, returns { accessToken, accountEmail }.
     */
    getService(service: GoogleService): Promise<{ accessToken: string; accountEmail: string }>;
};
```

### Module file pattern

```typescript
// src/mcp/tools/<service>.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../google-service";

export function register(server: McpServer, ctx: ToolContext): void {
    server.tool(
        "list_calendars",
        "List all available calendars",
        {},
        async () => {
            const { accessToken, accountEmail } = await ctx.getService("gcalendar");
            const resp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            return { content: [{ type: "text", text: await resp.text() }] };
        },
    );
}
```

### Wired in `MyMCP.init()`

```typescript
// After creating ctx:
import { register as registerCalendar } from "./tools/gcalendar";
registerCalendar(this.server, ctx);
// ... repeat for each module
```

---

## 6. getGoogleService Signature (P0d)

```typescript
// src/mcp/google-service.ts
async function getGoogleService(
    env: Env,
    userId: string,
    slug: string,
    service: GoogleService,
): Promise<{ accessToken: string; accountEmail: string }>
```

Internally: load config → assert enabled → load+decrypt token → refresh access token → return.

---

## 7. P0a Runtime Verification (deferred to Phase 3)

A `__debug_config` tool is registered in `MyMCP.init()`. It returns:
```json
{
  "slug": "my-workspace",
  "userId": "user_xxx",
  "config": { "slug": "my-workspace", "displayName": "...", "enabledServices": [...], ... },
  "googleAccountConnected": false
}
```

Full runtime confirmation happens in Phase 3 via Claude-in-Chrome after local startup
(`bun run dev`). Interactive Clerk OAuth makes headless testing impractical at this stage.
