// Google account-linking OAuth flow (separate from Clerk MCP-client OAuth).
// Operates entirely under Clerk browser session auth (handled by parent apiApp middleware).
//
// Routes (mounted at /google-auth in src/api/index.ts, served at /api/google-auth/* publicly):
//   GET  /start/:slug   → redirect user to Google consent
//   GET  /callback      → exchange code, store token, redirect to /app/configs/:slug
//   GET  /status/:slug  → { connected: bool, email?: string }
//   DELETE /:slug       → disconnect Google account (delete token, clear config fields)
//
// State token: stored in WS_KV under gauth-state:<token> with 10-minute TTL.
// Redirect URI: <origin>/api/google-auth/callback (must be registered in Google Cloud Console).

import { Hono } from "hono";
import { scopesForServices } from "../mcp/scopes";
import {
	deleteGoogleToken,
	loadGoogleConfig,
	loadGoogleToken,
	saveGoogleConfig,
	saveGoogleToken,
} from "../storage";

type Variables = { userId: string };

const googleAuthApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── OAuth state helpers ──────────────────────────────────────────────────────

interface GoogleAuthState {
	userId: string;
	slug: string;
	expiresAt: number;
}

const STATE_TTL_SECONDS = 600; // 10 minutes

function stateKey(token: string): string {
	return `gauth-state:${token}`;
}

async function saveState(
	env: Env,
	token: string,
	state: GoogleAuthState,
): Promise<void> {
	await env.WS_KV.put(stateKey(token), JSON.stringify(state), {
		expirationTtl: STATE_TTL_SECONDS,
	});
}

async function loadAndDeleteState(
	env: Env,
	token: string,
): Promise<GoogleAuthState | null> {
	const raw = await env.WS_KV.get<GoogleAuthState>(stateKey(token), "json");
	if (!raw) return null;
	await env.WS_KV.delete(stateKey(token));
	return raw;
}

// ─── Google API helpers ───────────────────────────────────────────────────────

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	scope?: string;
	error?: string;
	error_description?: string;
}

interface UserinfoResponse {
	sub?: string;
	email?: string;
	error?: string;
}

async function exchangeCode(
	env: Env,
	code: string,
	redirectUri: string,
): Promise<TokenResponse> {
	const resp = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			code,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}).toString(),
	});
	return resp.json<TokenResponse>();
}

async function fetchUserinfo(accessToken: string): Promise<UserinfoResponse> {
	const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	return resp.json<UserinfoResponse>();
}

// ─── GET /start/:slug ─────────────────────────────────────────────────────────

googleAuthApp.get("/start/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");

	const config = await loadGoogleConfig(c.env, userId, slug);
	if (!config) {
		return c.json({ error: `Config "${slug}" not found` }, 404);
	}

	// Build redirect URI from the incoming request origin
	const origin = new URL(c.req.url).origin;
	const redirectUri = `${origin}/api/google-auth/callback`;

	// Generate a cryptographically random state token
	const stateToken = crypto.randomUUID();
	await saveState(c.env, stateToken, {
		userId,
		slug,
		expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
	});

	// Build Google consent URL
	const scopes = scopesForServices(config.enabledServices);
	const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	googleAuthUrl.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
	googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
	googleAuthUrl.searchParams.set("response_type", "code");
	googleAuthUrl.searchParams.set("scope", scopes.join(" "));
	googleAuthUrl.searchParams.set("access_type", "offline");
	googleAuthUrl.searchParams.set("prompt", "consent");
	googleAuthUrl.searchParams.set("state", stateToken);

	return c.redirect(googleAuthUrl.toString());
});

// ─── GET /callback ────────────────────────────────────────────────────────────

googleAuthApp.get("/callback", async (c) => {
	const code = c.req.query("code");
	const stateToken = c.req.query("state");
	const errorParam = c.req.query("error");

	if (errorParam) {
		return c.json({ error: `Google OAuth error: ${errorParam}` }, 400);
	}
	if (!code || !stateToken) {
		return c.json({ error: "Missing code or state parameter" }, 400);
	}

	// Load and immediately delete state (one-time use).
	// The state token IS the identity proof: random UUID, single-use, 10-min TTL,
	// server-side userId+slug. Clerk session is NOT checked here because this route
	// is exempt from the Clerk middleware (cross-site redirect from accounts.google.com).
	const state = await loadAndDeleteState(c.env, stateToken);
	if (!state) {
		return c.json({ error: "Invalid or expired OAuth state" }, 400);
	}

	if (Date.now() > state.expiresAt) {
		return c.json({ error: "OAuth state expired" }, 400);
	}

	const origin = new URL(c.req.url).origin;
	const redirectUri = `${origin}/api/google-auth/callback`;

	// Exchange authorization code for tokens
	const tokens = await exchangeCode(c.env, code, redirectUri);
	if (tokens.error || !tokens.access_token) {
		const detail = tokens.error_description ?? tokens.error ?? "unknown error";
		return c.json({ error: `Token exchange failed: ${detail}` }, 502);
	}
	if (!tokens.refresh_token) {
		return c.json(
			{
				error:
					"No refresh token received. Ensure access_type=offline and prompt=consent were sent.",
			},
			502,
		);
	}

	// Fetch Google user identity
	const userinfo = await fetchUserinfo(tokens.access_token);
	if (!userinfo.email || !userinfo.sub) {
		return c.json({ error: "Failed to fetch Google user info" }, 502);
	}

	// Persist encrypted token
	await saveGoogleToken(c.env, state.userId, state.slug, {
		refreshToken: tokens.refresh_token,
		scope: tokens.scope ?? "",
		accountEmail: userinfo.email,
		accountSub: userinfo.sub,
		updatedAt: new Date().toISOString(),
	});

	// Update config with linked account info
	const config = await loadGoogleConfig(c.env, state.userId, state.slug);
	if (config) {
		await saveGoogleConfig(c.env, state.userId, {
			...config,
			googleAccountEmail: userinfo.email,
			googleAccountSub: userinfo.sub,
			updatedAt: new Date().toISOString(),
		});
	}

	// Redirect back to the config edit page
	return c.redirect(`/app/configs/${encodeURIComponent(state.slug)}`);
});

// ─── GET /status/:slug ────────────────────────────────────────────────────────

googleAuthApp.get("/status/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");

	const token = await loadGoogleToken(c.env, userId, slug);
	if (!token) {
		return c.json({ connected: false });
	}
	return c.json({ connected: true, email: token.accountEmail });
});

// ─── DELETE /:slug ────────────────────────────────────────────────────────────

googleAuthApp.delete("/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");

	await deleteGoogleToken(c.env, userId, slug);

	// Clear account fields from config
	const config = await loadGoogleConfig(c.env, userId, slug);
	if (config) {
		const {
			googleAccountEmail: _email,
			googleAccountSub: _sub,
			...rest
		} = config;
		await saveGoogleConfig(c.env, userId, {
			...rest,
			updatedAt: new Date().toISOString(),
		});
	}

	return new Response(null, { status: 204 });
});

export { googleAuthApp };
