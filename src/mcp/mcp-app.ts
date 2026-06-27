import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { ClerkHandler } from "../clerk-handler";
import type { Props } from "../utils";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Workspace MCP",
		version: "1.0.0",
	});

	async init() {
		// Pre-initialize tool request handlers before the transport connects.
		(
			this.server as unknown as { setToolRequestHandlers(): void }
		).setToolRequestHandlers();
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
