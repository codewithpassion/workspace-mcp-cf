import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Connection, ConnectionContext } from "agents";
import { McpAgent } from "agents/mcp";
import { ClerkHandler } from "../clerk-handler";
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
		await super.onConnect(conn, ctx);
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
		// Registration strategy: ALL tools registered unconditionally at init().
		// At call time, ctx.getService() checks enabledServices and throws
		// if the service is not enabled for the resolved config.
		// (Slug is unknown at init() so conditional registration is not possible.)
		registerCalendar(this.server, ctx);
		registerGmail(this.server, ctx);
		registerDrive(this.server, ctx);
		registerDocs(this.server, ctx);
		registerSheets(this.server, ctx);
		registerSlides(this.server, ctx);
		registerForms(this.server, ctx);
		registerTasks(this.server, ctx);
		registerChat(this.server, ctx);
		registerContacts(this.server, ctx);
		registerSearch(this.server, ctx);
		registerAppsScript(this.server, ctx);
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
