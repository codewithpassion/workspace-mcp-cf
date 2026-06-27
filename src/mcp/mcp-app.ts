import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
	McpServer,
	type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { ClerkHandler } from "../clerk-handler";
import { projects as projectsResource } from "../plane/resources/projects";
import { loadConfig, type PlaneConfigRecord } from "../plane/storage";
import { registerPlaneTools } from "../plane/tools";
import { deriveAppBaseUrl } from "../plane/url";
import type { Props } from "../utils";

/**
 * Run `registerPlaneTools` while intercepting `server.tool` so we capture
 * every `RegisteredTool` it produces. Lets us tear them all down later
 * when the underlying config changes.
 */
function registerPlaneToolsTracked(
	server: McpServer,
	ctx: Parameters<typeof registerPlaneTools>[1],
): RegisteredTool[] {
	const tracked: RegisteredTool[] = [];
	const originalTool = server.tool.bind(server) as typeof server.tool;
	(server as { tool: typeof server.tool }).tool = ((
		...args: Parameters<typeof server.tool>
	) => {
		const result = originalTool(...args);
		tracked.push(result);
		return result;
	}) as typeof server.tool;
	try {
		registerPlaneTools(server, ctx);
	} finally {
		(server as { tool: typeof server.tool }).tool = originalTool;
	}
	return tracked;
}

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Plane MCP Gateway",
		version: "1.0.0",
	});

	private slug?: string;
	private planeTools: RegisteredTool[] = [];
	private planeCfgVersion?: string;
	private instructionsCache?: {
		cfgVersion: string;
		expiresAt: number;
		text: string;
	};
	private static readonly INSTRUCTIONS_TTL_MS = 5 * 60_000;
	private static readonly INSTRUCTIONS_FAILURE_TTL_MS = 60_000;

	async init() {
		// Pre-initialize the tools request handlers before McpAgent.onStart
		// connects the transport. Without this, the first `server.tool()` call
		// inside `fetch()` would try to register capabilities post-connect and
		// throw "Cannot register capabilities after connecting to transport".
		(
			this.server as unknown as { setToolRequestHandlers(): void }
		).setToolRequestHandlers();
	}

	async fetch(request: Request): Promise<Response> {
		const slug = request.headers.get("X-Plane-Config-Slug") ?? undefined;
		if (slug && !this.slug) this.slug = slug;
		if (slug && this.slug && slug !== this.slug) {
			return new Response("session/slug mismatch", { status: 400 });
		}
		if (this.slug) {
			const cfg = await loadConfig(
				this.env,
				this.props?.userId ?? "",
				this.slug,
			);
			if (!cfg) {
				// Config deleted while session is live — drop tools and 410.
				// MCP client will see toolListChanged + an unknown-config error
				// on its next call.
				if (this.planeTools.length) {
					for (const t of this.planeTools) t.remove();
					this.planeTools = [];
					this.planeCfgVersion = undefined;
				}
				this.instructionsCache = undefined;
				return new Response("plane config no longer exists", { status: 410 });
			}
			await this.ensureInstructions(cfg);
			if (this.planeCfgVersion !== cfg.updatedAt) {
				for (const t of this.planeTools) t.remove();
				this.planeTools = registerPlaneToolsTracked(this.server, {
					config: {
						baseUrl: cfg.baseUrl ?? "https://api.plane.so",
						apiKey: cfg.apiKey,
					},
					workspaceSlug: cfg.planeWorkspaceSlug,
					projectId: cfg.projectId,
					appBaseUrl: deriveAppBaseUrl(cfg.baseUrl),
				});
				this.planeCfgVersion = cfg.updatedAt;
			}
		}
		return super.fetch(request);
	}

	private async ensureInstructions(cfg: PlaneConfigRecord): Promise<void> {
		const now = Date.now();
		const cached = this.instructionsCache;
		if (
			cached &&
			cached.cfgVersion === cfg.updatedAt &&
			now < cached.expiresAt
		) {
			return;
		}

		let text: string;
		let ttlMs = MyMCP.INSTRUCTIONS_TTL_MS;

		if (cfg.projectId) {
			text = renderPinnedInstructions(cfg);
		} else {
			try {
				const resp = await projectsResource.list(
					{
						baseUrl: cfg.baseUrl ?? "https://api.plane.so",
						apiKey: cfg.apiKey,
					},
					cfg.planeWorkspaceSlug,
					{ per_page: INSTRUCTIONS_PROJECT_CAP },
				);
				text = renderUnpinnedInstructions(cfg, resp.results ?? []);
			} catch (err) {
				console.warn("ensureInstructions: projects.list failed", err);
				text = renderWorkspaceBanner(cfg);
				ttlMs = MyMCP.INSTRUCTIONS_FAILURE_TTL_MS;
			}
		}

		(
			this.server.server as unknown as { _instructions?: string }
		)._instructions = text;
		this.instructionsCache = {
			cfgVersion: cfg.updatedAt,
			expiresAt: now + ttlMs,
			text,
		};
		console.log(
			`[mcp] instructions set for slug="${this.slug}" cfgVersion=${cfg.updatedAt} ttlMs=${ttlMs} length=${text.length}\n----- instructions begin -----\n${text}\n----- instructions end -----`,
		);
	}
}

const INSTRUCTIONS_PROJECT_CAP = 50;

function workspaceUrl(cfg: PlaneConfigRecord): string {
	return `${deriveAppBaseUrl(cfg.baseUrl)}/${cfg.planeWorkspaceSlug}`;
}

function urlPatternHint(cfg: PlaneConfigRecord): string {
	const ws = workspaceUrl(cfg);
	return [
		"URL patterns for this workspace (use these verbatim when answering 'what's the URL of …'):",
		`- Work item: ${ws}/projects/<project_id>/work-items/<work_item_id>/`,
		`- Project home: ${ws}/projects/<project_id>/`,
		`- Cycle: ${ws}/projects/<project_id>/cycles/<cycle_id>/`,
		`- Module: ${ws}/projects/<project_id>/modules/<module_id>/`,
		`- Page: ${ws}/projects/<project_id>/pages/<page_id>/`,
	].join("\n");
}

function renderWorkspaceBanner(cfg: PlaneConfigRecord): string {
	return `This MCP server is connected to the Plane workspace "${cfg.planeWorkspaceSlug}" at ${workspaceUrl(cfg)}/.`;
}

function renderPinnedInstructions(cfg: PlaneConfigRecord): string {
	const name = cfg.projectName ?? "(unnamed)";
	const ident = cfg.projectIdentifier ? ` (${cfg.projectIdentifier})` : "";
	const banner = `This MCP server is pinned to project "${name}"${ident} in Plane workspace "${cfg.planeWorkspaceSlug}" at ${workspaceUrl(cfg)}/. Tools that operate on a project act on this pinned project automatically — no project_id parameter is required.`;
	const pinned = cfg.projectId
		? `\n\nPinned project_id: ${cfg.projectId}\nProject home: ${workspaceUrl(cfg)}/projects/${cfg.projectId}/`
		: "";
	return `${banner}${pinned}\n\n${urlPatternHint(cfg)}`;
}

function renderUnpinnedInstructions(
	cfg: PlaneConfigRecord,
	projects: Array<{ id?: string | null; name: string; identifier: string }>,
): string {
	const banner = renderWorkspaceBanner(cfg);
	if (projects.length === 0) {
		return `${banner}\n\nNo projects found in this workspace. Use \`create_project\` to add one.\n\n${urlPatternHint(cfg)}`;
	}
	const lines = projects
		.filter((p) => p.id)
		.map((p) => `- ${p.identifier} — ${p.name} — id: ${p.id}`)
		.join("\n");
	const capped = projects.length >= INSTRUCTIONS_PROJECT_CAP;
	const footer = capped
		? `\n\nThis list is capped at ${INSTRUCTIONS_PROJECT_CAP} projects. Call \`list_projects\` to page through the full set.`
		: "\n\nIf a project you need is not listed, call `list_projects` for the full set.";
	return `${banner}\n\nAvailable projects (use the \`id\` as the \`project_id\` parameter):\n${lines}${footer}\nWhen a tool requires \`project_id\`, pick the matching id from this list.\n\n${urlPatternHint(cfg)}`;
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
