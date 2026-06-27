import { createClerkClient } from "@clerk/backend";
import { Hono } from "hono";
import { z } from "zod";
import {
	deleteGoogleConfig,
	deleteGoogleToken,
	type GoogleConfigRecord,
	listGoogleConfigs,
	loadGoogleConfig,
	saveGoogleConfig,
	validateSlug,
} from "../storage";
import { googleAuthApp } from "./google-auth";

type Variables = { userId: string };

const apiApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Clerk session auth middleware ────────────────────────────────────────────

apiApp.use("*", async (c, next) => {
	// The Google OAuth callback is reached via cross-site redirect from accounts.google.com.
	// Clerk session cookies may be absent or the handshake path may return non-authenticated
	// even with a valid session. Identity on the callback is proven by the KV state token
	// (single-use, 10-min TTL, stores userId+slug) — Clerk auth here adds only failure modes.
	if (c.req.path === "/google-auth/callback") {
		return next();
	}
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

// ─── Mount Google OAuth sub-app ───────────────────────────────────────────────

apiApp.route("/google-auth", googleAuthApp);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const GOOGLE_SERVICES = [
	"gmail",
	"gcalendar",
	"gdrive",
	"gdocs",
	"gsheets",
	"gslides",
	"gforms",
	"gtasks",
	"gchat",
	"gcontacts",
	"gsearch",
	"gappsscript",
] as const;

const googleServiceSchema = z.enum(GOOGLE_SERVICES);

const createBody = z.object({
	slug: z.string(),
	displayName: z.string().min(1),
	enabledServices: z.array(googleServiceSchema).min(1),
});

const patchBody = z.object({
	displayName: z.string().min(1).optional(),
	enabledServices: z.array(googleServiceSchema).min(1).optional(),
});

// ─── Config routes ────────────────────────────────────────────────────────────

apiApp.get("/configs", async (c) => {
	const userId = c.get("userId");
	const records = await listGoogleConfigs(c.env, userId);
	return c.json(records);
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

	const existing = await loadGoogleConfig(c.env, userId, parsed.data.slug);
	if (existing) {
		return c.json({ error: "slug already exists" }, 409);
	}

	const now = new Date().toISOString();
	const record: GoogleConfigRecord = {
		slug: parsed.data.slug,
		displayName: parsed.data.displayName,
		enabledServices: parsed.data.enabledServices,
		createdAt: now,
		updatedAt: now,
	};
	await saveGoogleConfig(c.env, userId, record);
	return c.json(record, 201);
});

apiApp.get("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	const cfg = await loadGoogleConfig(c.env, userId, c.req.param("slug"));
	if (!cfg) return c.json({ error: "not found" }, 404);
	return c.json(cfg);
});

apiApp.patch("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");
	const parsed = patchBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
	}
	const cfg = await loadGoogleConfig(c.env, userId, slug);
	if (!cfg) return c.json({ error: "not found" }, 404);
	const updated: GoogleConfigRecord = {
		...cfg,
		...parsed.data,
		updatedAt: new Date().toISOString(),
	};
	await saveGoogleConfig(c.env, userId, updated);
	return c.json(updated);
});

apiApp.delete("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	const slug = c.req.param("slug");
	// Delete both the config and any linked Google token
	await Promise.all([
		deleteGoogleConfig(c.env, userId, slug),
		deleteGoogleToken(c.env, userId, slug),
	]);
	return new Response(null, { status: 204 });
});

export { apiApp };
