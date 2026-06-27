# Analysis: google_workspace_mcp — Cross-Cutting Infrastructure

Analyzed version: taylorwilsdon/google_workspace_mcp (v1.22.0 FastMCP-based).
All file:line references are relative to `tmp/google_workspace_mcp/`.

---

## 1. OAuth / Auth Architecture

### Two parallel auth modes

**OAuth 2.0 (legacy, stdio)**
- Browser-based redirect to local callback server (`auth/oauth_callback_server.py`)
- Tokens stored on-disk as JSON files per user email
- Enabled when `MCP_ENABLE_OAUTH21=false` (default) or transport is `stdio`

**OAuth 2.1 (HTTP, current)**
- Enabled with `MCP_ENABLE_OAUTH21=true`
- FastMCP acts as an OAuth 2.1 proxy server between MCP clients and Google
- MCP clients authenticate via the server's OAuth endpoints (`/authorize`, `/callback`, `/token`, etc.)
- The server proxies through to Google OAuth on the user's behalf

### Google OAuth 2.1 flow (end-to-end)

1. **Client registers** via Dynamic Client Registration (DCR) on the server
2. **Client initiates auth** → server constructs a Google OAuth authorization URL with:
   - `access_type=offline`
   - `prompt=consent` (first time) or `prompt=select_account` (re-auth with existing creds)
   - PKCE `code_challenge` (S256)
   - `state` bound to MCP session ID
   - `login_hint` if email known
   - Requested scopes: all scopes for enabled services (`get_current_scopes()`)
   - `auth/google_auth.py:481-616` (`start_auth_flow`)
3. **User authorizes** on Google → Google redirects to `/oauth2callback` (or `/oauth2callback` path configured by `GOOGLE_OAUTH_REDIRECT_URI`)
4. **Callback handler** (`handle_auth_callback`, `auth/google_auth.py:631-881`):
   - Validates PKCE state (from `OAuth21SessionStore._oauth_states`)
   - Exchanges code for tokens (`Flow.fetch_token`)
   - Handles partial scope grants
   - Fetches user email via `get_user_info()` (calls `oauth2.userinfo().get()`)
   - Persists credentials to **two stores**: `LocalDirectoryCredentialStore` (or GCS) AND `OAuth21SessionStore`
   - Binds MCP session ID → user email (immutable binding)
5. **Server mints its own JWT** for the MCP client (FastMCP `GoogleProvider`)
6. **Client sends Bearer JWT** with every tool call; FastMCP validates it; `AuthInfoMiddleware` extracts user email into context state

### `py-key-value-aio` usage

This library is used **only for the FastMCP OAuth proxy's `client_storage`** (`core/server.py:396-605`). It stores the OAuth proxy state (client registrations, authorization codes, token records) — NOT the Google credentials. Three backends:
- `MemoryStore` — default for linux/stateless (`core/server.py:599-605`)
- `FileTreeStore` (disk) — `WORKSPACE_MCP_OAUTH_PROXY_STORAGE_BACKEND=disk` (`core/server.py:557-598`)
- `ValkeyStore` (Redis-compatible) — `WORKSPACE_MCP_OAUTH_PROXY_STORAGE_BACKEND=valkey` (`core/server.py:416-556`)

All disk/Valkey backends are wrapped with `FernetEncryptionWrapper` (key derived from `GOOGLE_OAUTH_CLIENT_SECRET` or `FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY`).

### Credential persistence and keying

**`LocalDirectoryCredentialStore`** (`auth/credential_store.py:78-293`):
- Path: `~/.google_workspace_mcp/credentials/{url_encoded_email}.json`
- JSON format: `{token, refresh_token, token_uri, client_id, client_secret, scopes, expiry}`
- File mode 0o600, directory mode 0o700
- Alternative: `GCSCredentialStore` for multi-user OAuth 2.1 cloud deployments
- Env var `WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND=gcs` to activate

**`OAuth21SessionStore`** (`auth/oauth21_session_store.py:223-971`) — in-memory singleton:
```python
_sessions: Dict[str, Dict]           # user_email → credential data + tokens
_mcp_session_mapping: Dict[str, str]  # mcp_session_id → user_email  (immutable once set)
_session_auth_binding: Dict[str, str] # any session_id → user_email (immutable)
_oauth_states: Dict[str, Dict]        # oauth_state → {session_id, code_verifier, expiry}
```
OAuth states are also persisted to disk at `~/.google_workspace_mcp/credentials/oauth_states.json` with file-locking (`auth/oauth21_session_store.py:359-434`).

### Token refresh

`get_credentials()` in `auth/google_auth.py:884-1190`:
1. Checks OAuth21SessionStore by MCP session ID
2. Falls back to `LocalDirectoryCredentialStore` by email
3. If expired, calls `credentials.refresh(Request())` (google-auth library)
4. On successful refresh: writes back to both `LocalDirectoryCredentialStore` and `OAuth21SessionStore`
5. On `RefreshError` (revoked/expired): returns None → triggers re-auth flow

### Multi-account support

Each user email is a separate key in all stores. The `_mcp_session_mapping` creates a **one-to-one immutable binding** between an MCP session ID and a user email at first auth (`auth/oauth21_session_store.py:651-664`). A single server process can have multiple users authenticated simultaneously.

### Single-user mode

`MCP_SINGLE_USER_MODE=1` bypasses session mapping; `_find_any_credentials()` returns the first available credential file (`auth/google_auth.py:114-153`).

### Per-request account resolution (the auth chain)

On every tool call, in order:
1. **`AuthInfoMiddleware.on_call_tool()`** (`auth/auth_info_middleware.py:372-391`) fires first
2. Calls `_process_request_for_auth()` which tries:
   a. `get_access_token()` (FastMCP's validated JWT) — extracts `email` from claims
   b. `Authorization: Bearer ya29.*` header → `auth_provider.verify_token(token_str)` → email
   c. MCP session binding lookup in `OAuth21SessionStore`
   d. stdio single-session fallback
3. Stores `authenticated_user_email` in FastMCP context state
4. **`require_google_service` wrapper** reads `authenticated_user_email` from context via `_get_auth_context()` (`auth/service_decorator.py:84-113`)

---

## 2. The `@require_google_service` Service-Injection Decorator

**Location**: `auth/service_decorator.py:684-838`

### Full signature

```python
def require_google_service(
    service_type: str,         # "gmail", "drive", "calendar", "docs", "sheets",
                               # "chat", "forms", "slides", "tasks", "people",
                               # "customsearch", "script"
    scopes: Union[str, List[str]],  # scope group names or raw URLs
    version: Optional[str] = None,   # overrides default version for service
):
```

### Mechanism (step by step)

```python
# auth/service_decorator.py:704-837
def decorator(func: Callable) -> Callable:
    original_sig = inspect.signature(func)
    params = list(original_sig.parameters.values())

    # REQUIREMENT: func must have 'service' as FIRST param
    if not params or params[0].name != "service":
        raise TypeError(...)

    # Build wrapper signature WITHOUT 'service'
    # In OAuth 2.1 mode: also remove 'user_google_email'
    if is_oauth21_enabled():
        filtered_params = [p for p in params[1:] if p.name != "user_google_email"]
    else:
        filtered_params = params[1:]  # only remove 'service'
    wrapper_sig = original_sig.replace(parameters=filtered_params)

    @wraps(func)
    async def wrapper(*args, **kwargs):
        # 1. Get auth context (authenticated_user, auth_method, mcp_session_id)
        authenticated_user, auth_method, mcp_session_id = await _get_auth_context(func.__name__)

        # 2. Resolve user email
        if is_oauth21_enabled():
            user_google_email = authenticated_user  # from JWT
        else:
            user_google_email = kwargs.get("user_google_email") or USER_GOOGLE_EMAIL

        # 3. Resolve service config and scopes
        config = SERVICE_CONFIGS[service_type]  # e.g. {"service": "calendar", "version": "v3"}
        resolved_scopes = _resolve_scopes(scopes)  # map group names to URLs

        # 4. Authenticate (picks OAuth 2.1 or 2.0 path)
        service, actual_user_email = await _authenticate_service(
            use_oauth21, service_name, service_version,
            func.__name__, user_google_email, resolved_scopes, mcp_session_id, authenticated_user
        )

        # 5. Call original function with service PREPENDED
        if is_oauth21_enabled():
            kwargs["user_google_email"] = user_google_email
        return await func(service, *args, **kwargs)

        # 6. Cleanup (in finally block)
        service.close()
        gc.collect()  # release cyclic references from googleapiclient

    wrapper.__signature__ = wrapper_sig
    wrapper._required_google_scopes = _resolve_scopes(scopes)  # used by tool filtering
    return wrapper
```

### `_authenticate_service()` (`auth/service_decorator.py:269-328`)

```python
async def _authenticate_service(...) -> Tuple[service, user_email]:
    # Priority 1: Service account (DWD)
    if is_service_account_enabled():
        credentials = _get_service_account_credentials(scopes, target_email)
        service = build(service_name, version, credentials=credentials)
        return service, target_email

    # Priority 2: OAuth 2.1
    if use_oauth21:
        return await get_authenticated_google_service_oauth21(...)

    # Priority 3: Legacy OAuth 2.0
    return await get_authenticated_google_service(...)
```

### `get_authenticated_google_service_oauth21()` (`auth/service_decorator.py:331-424`)

```python
async def get_authenticated_google_service_oauth21(...) -> Tuple[service, email]:
    provider = get_auth_provider()
    access_token = get_access_token()  # FastMCP's validated token object

    if provider and access_token:
        # Fast path: build credentials directly from validated access token
        credentials = ensure_session_from_access_token(access_token, resolved_email, session_id)
        # scope check
        service = build(service_name, version, credentials=credentials)
        return service, resolved_email

    # Fallback: look up from session store with security validation
    credentials = store.get_credentials_with_validation(
        requested_user_email=user_google_email,
        session_id=session_id,
        auth_token_email=auth_token_email,
    )
    service = build(service_name, version, credentials=credentials)
    return service, user_google_email
```

### Service build call (core of injection)

```python
# Legacy: authorized httplib2 transport
service = build(service_name, version, http=_build_authorized_http(credentials))

# OAuth 2.1: direct credentials object
service = build(service_name, version, credentials=credentials)
```

Where `_build_authorized_http()` wraps `google_auth_httplib2.AuthorizedHttp` with a 30s timeout.

### Tool authoring pattern (double-decorator stack)

```python
@server.tool(title="List Calendars", annotations=ToolAnnotations(...))
@handle_http_errors("list_calendars", ...)         # optional error handling decorator
@require_google_service("calendar", "calendar_read")
async def list_calendars(service, user_google_email: str) -> str:
    # 'service' is injected — do NOT call it a parameter in the MCP schema
    result = await asyncio.to_thread(lambda: service.calendarList().list().execute())
    return format(result)
```

**Critical stacking order**: `@require_google_service` must be **innermost** (closest to `def`). It rewrites the function signature (removes `service`, optionally removes `user_google_email`). `@server.tool()` must be **outermost** so FastMCP sees the already-rewritten signature.

### `require_multiple_services` (`auth/service_decorator.py:842-999`)

For tools needing two Google APIs simultaneously:
```python
@require_multiple_services([
    {"service_type": "drive", "scopes": "drive_read", "param_name": "drive_service"},
    {"service_type": "docs", "scopes": "docs_read",  "param_name": "docs_service"}
])
async def get_doc_with_metadata(drive_service, docs_service, user_google_email: str, doc_id: str):
    ...
```
Services injected into kwargs by `param_name`. All services closed via `ExitStack` in `finally`.

---

## 3. Scope Map (complete)

From `auth/scopes.py`:

| Service key | Scope URLs (full mode) |
|-------------|------------------------|
| `gmail` | `gmail.readonly`, `gmail.send`, `gmail.compose`, `gmail.modify`, `gmail.labels`, `gmail.settings.basic` |
| `drive` | `drive`, `drive.readonly`, `drive.file` |
| `calendar` | `calendar`, `calendar.readonly`, `calendar.events` |
| `docs` | `documents.readonly`, `documents`, `drive.readonly`, `drive.file` |
| `sheets` | `spreadsheets.readonly`, `spreadsheets`, `drive.readonly` |
| `chat` | `chat.messages.readonly`, `chat.messages`, `chat.spaces`, `chat.spaces.readonly` |
| `forms` | `forms.body`, `forms.body.readonly`, `forms.responses.readonly` |
| `slides` | `presentations`, `presentations.readonly` |
| `tasks` | `tasks`, `tasks.readonly` |
| `contacts` | `contacts`, `contacts.readonly` |
| `search` | `cse` |
| `appscript` | `script.projects`, `script.projects.readonly`, `script.deployments`, `script.deployments.readonly`, `script.processes`, `script.metrics`, `script.external_request`, `script.scriptapp`, `drive.file` |

**Base scopes** (always included): `userinfo.email`, `userinfo.profile`, `openid`

**Scope hierarchy** (`auth/scopes.py:91-110`) allows broader scopes to satisfy narrower requirements:
```
gmail.modify ⊇ {gmail.readonly, gmail.send, gmail.compose, gmail.labels}
drive ⊇ {drive.readonly, drive.file}
calendar ⊇ {calendar.readonly, calendar.events}
documents ⊇ {documents.readonly}
spreadsheets ⊇ {spreadsheets.readonly}
```

**Scope group names** (used in `@require_google_service`'s `scopes` arg):
- `"calendar_read"` → `https://www.googleapis.com/auth/calendar.readonly`
- `"calendar_events"` → `https://www.googleapis.com/auth/calendar.events`
- `"calendar"` → `https://www.googleapis.com/auth/calendar`
- `"gmail_read"` / `"gmail_send"` / `"gmail_modify"` / etc.
- `"drive"` / `"drive_read"` / `"drive_file"`
- `"docs_read"` / `"docs_write"`
- `"sheets_read"` / `"sheets_write"`
- …(see `SCOPE_GROUPS` in `auth/service_decorator.py:534-586`)

---

## 4. Service-Selection / Tool Enablement Mechanism

### Step 1: Import-time tool registration

All service modules are imported explicitly in `fastmcp_server.py:148-157`:
```python
import gmail.gmail_tools
import gdrive.drive_tools
# ...etc
```
Each import executes module-level `@server.tool()` decorators, registering all tools.

### Step 2: Scope selection per enabled services

`auth/scopes.py:236-244`:
```python
def set_enabled_tools(enabled_tools):  # list of service names: ["gmail", "calendar", ...]
    global _ENABLED_TOOLS
    _ENABLED_TOOLS = enabled_tools
```
`get_current_scopes()` / `get_scopes_for_tools()` uses `_ENABLED_TOOLS` to compute the scope list sent to Google OAuth (`auth/scopes.py:277-341`). This is called when building the `GoogleProvider` (`core/server.py:399`).

### Step 3: Post-registration tool filtering

`filter_server_tools(server)` in `core/tool_registry.py:104-211` removes tools from `server.local_provider` based on four criteria:
1. **Tier filtering**: if `_enabled_tools` is a set (not None), remove any tool not in set
2. **OAuth 2.1 mode**: removes `start_google_auth` tool (legacy OAuth tool)
3. **Read-only mode** (`--read-only` flag): checks `_required_google_scopes` attribute on each tool function; if any scope requires write, removes the tool
4. **Granular permissions mode**: checks `_required_google_scopes` against allowed permission-level scopes

The `_required_google_scopes` attribute is attached by `@require_google_service` (`auth/service_decorator.py:835`):
```python
wrapper._required_google_scopes = _resolve_scopes(scopes)
```

### Tool tiers (YAML-based subsetting)

`core/tool_tiers.yaml` defines three tier levels:
- `core` — minimum set of tools
- `extended` — core + additional
- `complete` — all tools

`ToolTierLoader.get_tools_up_to_tier(tier, services)` returns cumulative tool names up to the specified tier. Callers pass the result to `set_enabled_tools()`.

---

## 5. Transport and Session Management

### Streamable-HTTP transport

- Default for FastMCP Cloud (`fastmcp_server.py:145`)
- `fastmcp.json` sets `"transport": "http"`
- `SecureFastMCP.http_app()` installs middleware stack in order: `WellKnownCacheControlMiddleware` → `OriginValidationMiddleware` → `MCPSessionMiddleware`
- `MCPSessionMiddleware` (`auth/mcp_session_middleware.py`) extracts `mcp-session-id` from headers, builds `SessionContext`, pushes it via `contextvars` for the request lifetime
- Each MCP session ID maps to exactly one user (immutable after first binding)

### SSE transport

- Legacy, deprecated; same auth paths apply
- Route: `/mcp` (Streamable-HTTP) or `/sse` (legacy SSE) — both are handled by FastMCP

### Session-to-account resolution

```
HTTP request
  └── mcp-session-id header
        └── MCPSessionMiddleware: sets contextvars
              └── FastMCP validates JWT → AccessToken with email claims
                    └── AuthInfoMiddleware: stores "authenticated_user_email" in context state
                          └── require_google_service wrapper: reads from context state
                                └── get_authenticated_google_service_oauth21: builds service
```

---

## 6. Server Bootstrap Sequence

From `fastmcp_server.py` (FastMCP Cloud entrypoint):

1. Force OAuth 2.1 + stateless defaults (`enforce_fastmcp_cloud_defaults()`)
2. `reload_oauth_config()` — reads all env vars into `OAuthConfig` singleton
3. `set_transport_mode("streamable-http")`
4. Import tool modules → all `@server.tool()` + `@require_google_service` decorators run
5. `wrap_server_tool_method(server)` — monkey-patches `server.tool` to track registrations
6. `set_enabled_tools(all_services)` — sets scope list for OAuth
7. `filter_server_tools(server)` — removes disabled tools from `local_provider`
8. `configure_server_for_http()` — initializes `GoogleProvider` with `client_storage` + `jwt_signing_key`, calls `server.auth = provider`, registers `set_auth_provider(provider)`
9. FastMCP CLI starts the ASGI server

---

## 7. Key Env Vars Summary

| Variable | Purpose |
|---|---|
| `MCP_ENABLE_OAUTH21` | Enable OAuth 2.1 mode (`true`/`false`) |
| `WORKSPACE_MCP_STATELESS_MODE` | No local credential files (requires OAuth 2.1) |
| `MCP_SINGLE_USER_MODE` | Skip session binding, use any available creds |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Override callback URI |
| `USER_GOOGLE_EMAIL` | Default user email for single-user mode |
| `WORKSPACE_MCP_CREDENTIALS_DIR` | Override credential file directory |
| `WORKSPACE_MCP_OAUTH_PROXY_STORAGE_BACKEND` | `memory`/`disk`/`valkey` for py-key-value-aio |
| `WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND` | `local_directory` or `gcs` for Google creds |
| `EXTERNAL_OAUTH21_PROVIDER` | Accept raw `ya29.*` bearer tokens directly |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Service account JSON file path (DWD mode) |
