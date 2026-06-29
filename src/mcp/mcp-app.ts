import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
	McpServer,
	type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Connection, ConnectionContext } from "agents";
import { McpAgent } from "agents/mcp";
import { ClerkHandler } from "../clerk-handler";
import { type GoogleService, loadGoogleConfig } from "../storage";
import type { Props } from "../utils";
import { getGoogleService, type ToolContext } from "./google-service";
import { register as registerAppsScript } from "./tools/gappsscript";
import { register as registerCalendar } from "./tools/gcalendar";
import { register as registerChat } from "./tools/gchat";
import { register as registerContacts } from "./tools/gcontacts";
import { register as registerDocs } from "./tools/gdocs";
import { register as registerDrive } from "./tools/gdrive";
import { register as registerForms } from "./tools/gforms";
import { register as registerGmail } from "./tools/gmail";
import { register as registerSearch } from "./tools/gsearch";
import { register as registerSheets } from "./tools/gsheets";
import { register as registerSlides } from "./tools/gslides";
import { register as registerTasks } from "./tools/gtasks";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Workspace MCP",
		version: "1.0.0",
	});

	/**
	 * Slug captured from the X-Config-Slug header in onConnect.
	 * NOT available at init() time — only set once a connection is established.
	 * All tool handlers must read this lazily (via ToolContext.getSlug()).
	 */
	private _slug: string | undefined = undefined;

	/**
	 * Maps each registered tool to the GoogleService it belongs to, recorded as
	 * tools register (see taggedServer). Used by applyServiceFilter() to toggle
	 * each tool's `enabled` flag based on the active config's enabledServices.
	 */
	private _toolHandles: Array<{
		service: GoogleService;
		tool: RegisteredTool;
	}> = [];

	/** The slug the tool filter was last applied for; guards re-running it. */
	private _filteredForSlug: string | undefined = undefined;

	/**
	 * Capture the config slug from the X-Config-Slug header before the parent
	 * handler processes the MCP message. This fires for EVERY incoming request
	 * (POST tool calls and GET SSE streams), so the slug is always current even
	 * after DO hibernation.
	 *
	 * Evidence: the agents/mcp serve() handler copies ALL original headers —
	 * including X-Config-Slug — into the forwarded request (mcp/index.js:153-162).
	 * onConnect then receives that request via ConnectionContext.request.
	 * The library's own dispatch depends on this same mechanism for its internal
	 * MCP_HTTP_METHOD_HEADER, proving our custom header also survives the hop.
	 */
	override async onConnect(
		conn: Connection,
		ctx: ConnectionContext,
	): Promise<void> {
		const slug = ctx.request.headers.get("X-Config-Slug");
		if (slug) this._slug = slug;
		await this.applyServiceFilter();
		await super.onConnect(conn, ctx);
	}

	/**
	 * Restricts the advertised tool surface to the services enabled for the
	 * active config. All tools are registered unconditionally at init() (the slug
	 * is unknown then), so without this filter tools/list would expose all 121
	 * tools regardless of the endpoint's enabledServices. Here — once the slug is
	 * known — we flip each tool's `enabled` flag, which the SDK honours in BOTH
	 * tools/list (filtered out) and tools/call (rejected). The call-time check in
	 * getGoogleService() remains as defense-in-depth.
	 *
	 * Runs once per session (the slug is sealed per DO). We set `enabled`
	 * directly rather than calling .disable()/.enable(): those go through
	 * update() → sendToolListChanged(), emitting a spurious tools/list_changed
	 * notification. The flag is applied before the client's first tools/list, so
	 * no notification is needed.
	 */
	private async applyServiceFilter(): Promise<void> {
		const slug = this._slug;
		const userId = this.props?.userId;
		// props/slug may not be populated on the very first connect; a later
		// request's onConnect will apply the filter before tools/list runs.
		if (!slug || !userId) return;
		if (this._filteredForSlug === slug) return;

		const config = await loadGoogleConfig(this.env, userId, slug);
		const enabled = new Set<GoogleService>(config?.enabledServices ?? []);
		for (const { service, tool } of this._toolHandles) {
			tool.enabled = enabled.has(service);
		}
		this._filteredForSlug = slug;
	}

	/**
	 * Returns a proxy over `this.server` that behaves identically except it
	 * records every tool registered through it under `service`, so the list
	 * filter (applyServiceFilter) knows which service each tool belongs to.
	 */
	private taggedServer(service: GoogleService): McpServer {
		const real = this.server;
		const handles = this._toolHandles;
		return new Proxy(real, {
			get(target, prop, receiver) {
				if (prop === "tool") {
					return (...args: Parameters<McpServer["tool"]>) => {
						const handle = target.tool(...args);
						handles.push({ service, tool: handle });
						return handle;
					};
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}

	async init() {
		// Pre-initialize tool request handlers before the transport connects.
		(
			this.server as unknown as { setToolRequestHandlers(): void }
		).setToolRequestHandlers();

		// Build the ToolContext passed to all module register() functions.
		// All getters are late-bound: they read this._slug / this.props at CALL TIME,
		// not at registration time. This is required because init() runs before any
		// connection exists and this._slug is therefore undefined here.
		const ctx: ToolContext = {
			env: this.env,
			getUserId: () => {
				const uid = this.props?.userId;
				if (!uid)
					throw new Error("userId unavailable — no authenticated session");
				return uid;
			},
			getSlug: () => {
				if (!this._slug)
					throw new Error("Config slug unavailable — no active MCP session");
				return this._slug;
			},
			getService: (service) => {
				const uid = this.props?.userId;
				if (!uid)
					throw new Error("userId unavailable — no authenticated session");
				if (!this._slug)
					throw new Error("Config slug unavailable — no active MCP session");
				return getGoogleService(this.env, uid, this._slug, service);
			},
		};

		// ─── Module tool registrations ─────────────────────────────────────────
		// Registration strategy: ALL tools registered unconditionally at init()
		// (the slug — and thus the config's enabledServices — is unknown here).
		// Each module registers through taggedServer(service) so every tool is
		// tagged with its GoogleService; once a connection is established and the
		// slug is known, applyServiceFilter() disables tools whose service isn't
		// enabled for the config, so tools/list and tools/call only expose the
		// selected services. ctx.getService() also re-checks at call time.
		registerCalendar(this.taggedServer("gcalendar"), ctx);
		registerGmail(this.taggedServer("gmail"), ctx);
		registerDrive(this.taggedServer("gdrive"), ctx);
		registerDocs(this.taggedServer("gdocs"), ctx);
		registerSheets(this.taggedServer("gsheets"), ctx);
		registerSlides(this.taggedServer("gslides"), ctx);
		registerForms(this.taggedServer("gforms"), ctx);
		registerTasks(this.taggedServer("gtasks"), ctx);
		registerChat(this.taggedServer("gchat"), ctx);
		registerContacts(this.taggedServer("gcontacts"), ctx);
		registerSearch(this.taggedServer("gsearch"), ctx);
		registerAppsScript(this.taggedServer("gappsscript"), ctx);
	}
}

export const oauthProvider = new OAuthProvider({
	apiHandlers: {
		"/sse": MyMCP.serveSSE("/sse"),
		"/mcp": MyMCP.serve("/mcp"),
	},
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: ClerkHandler as unknown as ExportedHandler,
	tokenEndpoint: "/token",
});

/**
 * Apply two transformations on responses coming back from oauthProvider:
 *  - rewrite http:// to https:// in OAuth Authorization Server metadata for tunnels
 *  - add resource_metadata to WWW-Authenticate on 401 (RFC 9728)
 */
export async function wrapOAuthResponse(
	response: Response,
	request: Request,
): Promise<Response> {
	const url = new URL(request.url);
	const isHTTPS =
		url.hostname !== "localhost" && !url.hostname.startsWith("127.");

	if (
		isHTTPS &&
		url.pathname === "/.well-known/oauth-authorization-server" &&
		response.status === 200
	) {
		const metadata = await response.json<Record<string, unknown>>();
		const fixedMetadata = JSON.parse(
			JSON.stringify(metadata).replace(
				new RegExp(`http://${url.hostname}`, "g"),
				`https://${url.hostname}`,
			),
		);
		return new Response(JSON.stringify(fixedMetadata), {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers),
		});
	}

	if (response.status === 401) {
		if (isHTTPS) url.protocol = "https:";
		url.pathname = "/.well-known/oauth-protected-resource";
		url.search = "";
		url.hash = "";
		const resourceMetadataUrl = url.href;

		const existingAuth = response.headers.get("WWW-Authenticate");
		const newHeaders = new Headers(response.headers);
		if (existingAuth) {
			newHeaders.set(
				"WWW-Authenticate",
				`${existingAuth}, resource_metadata="${resourceMetadataUrl}"`,
			);
		} else {
			newHeaders.set(
				"WWW-Authenticate",
				`Bearer resource_metadata="${resourceMetadataUrl}"`,
			);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		});
	}

	return response;
}
