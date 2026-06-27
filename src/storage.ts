// All config and token storage for the Google Workspace MCP gateway.
// Namespace: WS_KV (separate from OAUTH_KV which is owned by @cloudflare/workers-oauth-provider).
//
// KV key scheme:
//   cfg:<userId>:<slug>  → GoogleConfigRecord  (JSON)
//   gtok:<userId>:<slug> → stored token JSON where refreshToken is AES-GCM encrypted

export type GoogleService =
	| "gmail"
	| "gcalendar"
	| "gdrive"
	| "gdocs"
	| "gsheets"
	| "gslides"
	| "gforms"
	| "gtasks"
	| "gchat"
	| "gcontacts"
	| "gsearch"
	| "gappsscript";

export interface GoogleConfigRecord {
	slug: string;
	displayName: string;
	enabledServices: GoogleService[];
	/** Set after Google OAuth completes. */
	googleAccountEmail?: string;
	/** Google 'sub' claim — stable, immutable account id. Set after Google OAuth. */
	googleAccountSub?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Stored in KV under gtok:<userId>:<slug>.
 * At the public API level, refreshToken is plaintext; storage layer encrypts/decrypts.
 */
export interface GoogleTokenRecord {
	refreshToken: string;
	scope: string;
	accountEmail: string;
	accountSub: string;
	updatedAt: string;
}

// ─── key helpers ──────────────────────────────────────────────────────────────

const cfgKey = (userId: string, slug: string) => `cfg:${userId}:${slug}`;
const cfgPrefix = (userId: string) => `cfg:${userId}:`;
const tokKey = (userId: string, slug: string) => `gtok:${userId}:${slug}`;

// ─── slug validation ──────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RESERVED_SLUGS = new Set([
	"mcp",
	"sse",
	"app",
	"api",
	"authorize",
	"callback",
	"register",
	"token",
	"well-known",
]);

export function validateSlug(
	slug: string,
): { ok: true } | { ok: false; error: string } {
	if (!SLUG_RE.test(slug)) {
		return {
			ok: false,
			error: "slug must match ^[a-z0-9][a-z0-9-]{1,62}$",
		};
	}
	if (RESERVED_SLUGS.has(slug)) {
		return { ok: false, error: `slug "${slug}" is reserved` };
	}
	return { ok: true };
}

// ─── config CRUD ─────────────────────────────────────────────────────────────

export async function loadGoogleConfig(
	env: Env,
	userId: string,
	slug: string,
): Promise<GoogleConfigRecord | null> {
	return env.WS_KV.get<GoogleConfigRecord>(cfgKey(userId, slug), "json");
}

export async function saveGoogleConfig(
	env: Env,
	userId: string,
	cfg: GoogleConfigRecord,
): Promise<void> {
	await env.WS_KV.put(cfgKey(userId, cfg.slug), JSON.stringify(cfg));
}

export async function deleteGoogleConfig(
	env: Env,
	userId: string,
	slug: string,
): Promise<void> {
	await env.WS_KV.delete(cfgKey(userId, slug));
}

export async function listGoogleConfigs(
	env: Env,
	userId: string,
): Promise<GoogleConfigRecord[]> {
	const list = await env.WS_KV.list({ prefix: cfgPrefix(userId) });
	const records = await Promise.all(
		list.keys.map((k) => env.WS_KV.get<GoogleConfigRecord>(k.name, "json")),
	);
	return records.filter((r): r is GoogleConfigRecord => r !== null);
}

// ─── token CRUD (with AES-GCM encryption of refreshToken) ────────────────────

/** Internal shape stored in KV: refreshToken field is AES-GCM encrypted. */
interface StoredTokenRecord extends Omit<GoogleTokenRecord, "refreshToken"> {
	encryptedRefreshToken: string;
}

export async function saveGoogleToken(
	env: Env,
	userId: string,
	slug: string,
	record: GoogleTokenRecord,
): Promise<void> {
	const encrypted = await encryptValue(
		record.refreshToken,
		env.GOOGLE_TOKEN_ENCRYPTION_KEY,
	);
	const stored: StoredTokenRecord = {
		encryptedRefreshToken: encrypted,
		scope: record.scope,
		accountEmail: record.accountEmail,
		accountSub: record.accountSub,
		updatedAt: record.updatedAt,
	};
	await env.WS_KV.put(tokKey(userId, slug), JSON.stringify(stored));
}

export async function loadGoogleToken(
	env: Env,
	userId: string,
	slug: string,
): Promise<GoogleTokenRecord | null> {
	const stored = await env.WS_KV.get<StoredTokenRecord>(
		tokKey(userId, slug),
		"json",
	);
	if (!stored) return null;
	const refreshToken = await decryptValue(
		stored.encryptedRefreshToken,
		env.GOOGLE_TOKEN_ENCRYPTION_KEY,
	);
	return {
		refreshToken,
		scope: stored.scope,
		accountEmail: stored.accountEmail,
		accountSub: stored.accountSub,
		updatedAt: stored.updatedAt,
	};
}

export async function deleteGoogleToken(
	env: Env,
	userId: string,
	slug: string,
): Promise<void> {
	await env.WS_KV.delete(tokKey(userId, slug));
}

// ─── AES-GCM helpers ─────────────────────────────────────────────────────────

/**
 * Encrypts a UTF-8 plaintext string with AES-256-GCM.
 * Returns a base64-encoded string containing a 12-byte random IV prepended to the ciphertext.
 * Key must be a 64-char hex string (32 bytes / 256 bits).
 */
export async function encryptValue(
	plaintext: string,
	hexKey: string,
): Promise<string> {
	const key = await importAesKey(hexKey);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		encoded,
	);
	// Prepend IV to ciphertext and base64-encode the result
	const combined = new Uint8Array(12 + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), 12);
	let binary = "";
	for (const byte of combined) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Decrypts a base64-encoded AES-256-GCM ciphertext produced by encryptValue.
 * Expects the first 12 bytes to be the IV.
 */
export async function decryptValue(
	encoded: string,
	hexKey: string,
): Promise<string> {
	const key = await importAesKey(hexKey);
	const combined = new Uint8Array(
		atob(encoded)
			.split("")
			.map((c) => c.charCodeAt(0)),
	);
	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(decrypted);
}

/**
 * Imports a 64-char hex string as an AES-256-GCM CryptoKey.
 * The hex is decoded to 32 raw bytes (not UTF-8 encoded) before import.
 */
async function importAesKey(hexKey: string): Promise<CryptoKey> {
	const matches = hexKey.match(/.{1,2}/g);
	if (!matches || matches.length !== 32) {
		throw new Error(
			"GOOGLE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
		);
	}
	const bytes = new Uint8Array(matches.map((b) => Number.parseInt(b, 16)));
	return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}
