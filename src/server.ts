import startHandler from "@tanstack/react-start/server-entry";
import { apiApp } from "./api";
import { MyMCP, oauthProvider, wrapOAuthResponse } from "./mcp/mcp-app";

export { MyMCP };

const MCP_SLUG_RE = /^\/(mcp|sse)\/([^/]+)(\/.*)?$/;
const OAUTH_DIRECT_RE = /^\/(authorize|callback|register|token|\.well-known)/;

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		const mcpMatch = url.pathname.match(MCP_SLUG_RE);
		if (mcpMatch) {
			const [, transport, slug, rest] = mcpMatch;
			const rewritten = new URL(request.url);
			rewritten.pathname = `/${transport}${rest ?? ""}`;
			const headers = new Headers(request.headers);
			headers.set("X-Plane-Config-Slug", slug);
			const forwarded = new Request(rewritten, {
				method: request.method,
				headers,
				body: request.body,
				redirect: "manual",
			});
			const res = await oauthProvider.fetch(forwarded, env, ctx);
			return wrapOAuthResponse(res, forwarded);
		}

		if (OAUTH_DIRECT_RE.test(url.pathname)) {
			const res = await oauthProvider.fetch(request, env, ctx);
			return wrapOAuthResponse(res, request);
		}

		if (url.pathname.startsWith("/api/")) {
			const stripped = new URL(request.url);
			stripped.pathname = url.pathname.slice(4);
			const forwarded = new Request(stripped, request);
			return apiApp.fetch(forwarded, env, ctx);
		}

		return startHandler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
