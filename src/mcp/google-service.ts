// google-service.ts — equivalent of Python's @require_google_service decorator.
//
// Single foundation primitive every Google tool uses:
//   getGoogleService(env, userId, slug, service) → { accessToken, accountEmail }
//
// Also exports ToolContext — the FROZEN interface that all 11 module agents build against.
// Do NOT change ToolContext without updating all module files.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type GoogleService,
	loadGoogleConfig,
	loadGoogleToken,
} from "../storage";

// ─── ToolContext (frozen interface) ──────────────────────────────────────────
//
// Created once in MyMCP.init(). All getters are LATE-BOUND: they read instance
// fields (this._slug, this.props) at call time, not at registration time.
// This is required because init() runs before any connection is established and
// the slug is therefore unknown when tools are registered.
//
// Module usage pattern:
//   import type { ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }

export type ToolContext = {
	/** Cloudflare Workers bindings — available at init() time. */
	env: Env;
	/** Returns the Clerk userId for the authenticated user. Throws if unavailable. */
	getUserId(): string;
	/**
	 * Returns the config slug for the active MCP session.
	 * Throws if called outside of an active connection (i.e., before onConnect fires).
	 */
	getSlug(): string;
	/**
	 * Loads the config for this session, asserts the service is enabled,
	 * decrypts the stored refresh token, refreshes a Google access token,
	 * and returns it together with the linked account email.
	 * Throws if the config is missing, the service is not enabled,
	 * or the Google account is not connected.
	 */
	getService(
		service: GoogleService,
	): Promise<{ accessToken: string; accountEmail: string }>;
};

// Satisfy TypeScript: McpServer re-exported for module files that need the type.
export type { McpServer };

// ─── getGoogleService ─────────────────────────────────────────────────────────

/**
 * Resolves the Google access token for the given userId + slug + service.
 * Implements the full chain:
 *   1. Load GoogleConfigRecord; throw if absent.
 *   2. Assert service ∈ enabledServices; throw if not.
 *   3. Load + decrypt GoogleTokenRecord; throw if absent ("account not connected").
 *   4. Refresh access token via Google token endpoint.
 *   5. Return { accessToken, accountEmail }.
 */
export async function getGoogleService(
	env: Env,
	userId: string,
	slug: string,
	service: GoogleService,
): Promise<{ accessToken: string; accountEmail: string }> {
	const config = await loadGoogleConfig(env, userId, slug);
	if (!config) {
		throw new Error(`Config "${slug}" not found`);
	}

	if (!config.enabledServices.includes(service)) {
		throw new Error(
			`Service "${service}" is not enabled for config "${slug}". ` +
				`Enabled: ${config.enabledServices.join(", ") || "(none)"}`,
		);
	}

	const tokenRecord = await loadGoogleToken(env, userId, slug);
	if (!tokenRecord) {
		throw new Error(
			`Google account not connected for config "${slug}". ` +
				"Connect via the web UI first.",
		);
	}

	const accessToken = await refreshGoogleAccessToken(
		tokenRecord.refreshToken,
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
	);

	return { accessToken, accountEmail: tokenRecord.accountEmail };
}

// ─── internal: token refresh ──────────────────────────────────────────────────

interface TokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

async function refreshGoogleAccessToken(
	refreshToken: string,
	clientId: string,
	clientSecret: string,
): Promise<string> {
	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}).toString(),
	});

	const data = await resp.json<TokenResponse>();

	if (!resp.ok || !data.access_token) {
		const detail = data.error_description ?? data.error ?? resp.statusText;
		throw new Error(`Failed to refresh Google access token: ${detail}`);
	}

	return data.access_token;
}
