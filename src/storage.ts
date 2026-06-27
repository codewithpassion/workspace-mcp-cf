export interface ConfigRecord {
	slug: string;
	displayName: string;
	apiKey: string;
	baseUrl?: string;
	createdAt: string;
	updatedAt: string;
}

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

export function redactApiKey(key: string): string {
	return `••••${key.slice(-4)}`;
}

export const cfgKey = (userId: string, slug: string) =>
	`ws:cfg:${userId}:${slug}`;

const userPrefix = (userId: string) => `ws:cfg:${userId}:`;

export async function loadConfig(
	env: Env,
	userId: string,
	slug: string,
): Promise<ConfigRecord | null> {
	return env.OAUTH_KV.get<ConfigRecord>(cfgKey(userId, slug), "json");
}

export async function saveConfig(
	env: Env,
	userId: string,
	cfg: ConfigRecord,
): Promise<void> {
	await env.OAUTH_KV.put(cfgKey(userId, cfg.slug), JSON.stringify(cfg));
}

export async function deleteConfig(
	env: Env,
	userId: string,
	slug: string,
): Promise<void> {
	await env.OAUTH_KV.delete(cfgKey(userId, slug));
}

export async function listConfigs(
	env: Env,
	userId: string,
): Promise<ConfigRecord[]> {
	const list = await env.OAUTH_KV.list({ prefix: userPrefix(userId) });
	const records = await Promise.all(
		list.keys.map((k) => env.OAUTH_KV.get<ConfigRecord>(k.name, "json")),
	);
	return records.filter((r): r is ConfigRecord => r !== null);
}
