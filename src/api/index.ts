import { createClerkClient } from "@clerk/backend";
import { Hono } from "hono";
import { z } from "zod";
import {
	deleteConfig,
	listConfigs,
	loadConfig,
	type ConfigRecord,
	redactApiKey,
	saveConfig,
	validateSlug,
} from "../storage";

type Variables = { userId: string };

const apiApp = new Hono<{ Bindings: Env; Variables: Variables }>();

apiApp.use("*", async (c, next) => {
	try {
		const clerk = createClerkClient({
			secretKey: c.env.CLERK_SECRET_KEY,
			publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
		});
		const requestState = await clerk.authenticateRequest(c.req.raw, {
			secretKey: c.env.CLERK_SECRET_KEY,
			publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
		});
		if (!requestState.isAuthenticated) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		const auth = requestState.toAuth();
		if (!auth?.userId) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		c.set("userId", auth.userId);
		await next();
	} catch (err) {
		console.error("Clerk auth error:", err);
		return c.json({ error: "unauthenticated" }, 401);
	}
});

function redact(cfg: ConfigRecord): ConfigRecord {
	return { ...cfg, apiKey: redactApiKey(cfg.apiKey) };
}

const createBody = z.object({
	slug: z.string(),
	displayName: z.string().min(1),
	apiKey: z.string().min(1),
	baseUrl: z.string().url().optional(),
});

const patchBody = z.object({
	displayName: z.string().min(1).optional(),
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().url().optional(),
});

apiApp.get("/configs", async (c) => {
	const userId = c.get("userId");
	const records = await listConfigs(c.env, userId);
	return c.json(records.map(redact));
});

apiApp.post("/configs", async (c) => {
	const userId = c.get("userId");
	const parsed = createBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
	}
	const slugCheck = validateSlug(parsed.data.slug);
	if (!slugCheck.ok) {
		return c.json({ error: slugCheck.error }, 400);
	}
	const existing = await loadConfig(c.env, userId, parsed.data.slug);
	if (existing) {
		return c.json({ error: "slug already exists" }, 409);
	}
	const now = new Date().toISOString();
	const record: ConfigRecord = {
		slug: parsed.data.slug,
		displayName: parsed.data.displayName,
		apiKey: parsed.data.apiKey,
		baseUrl: parsed.data.baseUrl,
		createdAt: now,
		updatedAt: now,
	};
	await saveConfig(c.env, userId, record);
	return c.json(redact(record), 201);
});

apiApp.get("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	const cfg = await loadConfig(c.env, userId, c.req.param("slug"));
	if (!cfg) return c.json({ error: "not found" }, 404);
	return c.json(redact(cfg));
});

apiApp.patch("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");
	const parsed = patchBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
	}
	const cfg = await loadConfig(c.env, userId, slug);
	if (!cfg) return c.json({ error: "not found" }, 404);
	const updated: ConfigRecord = {
		...cfg,
		...parsed.data,
		updatedAt: new Date().toISOString(),
	};
	await saveConfig(c.env, userId, updated);
	return c.json(redact(updated));
});

apiApp.delete("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	await deleteConfig(c.env, userId, c.req.param("slug"));
	return new Response(null, { status: 204 });
});

export { apiApp };
