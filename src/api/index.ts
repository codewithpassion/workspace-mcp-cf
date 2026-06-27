import { createClerkClient } from "@clerk/backend";
import { Hono } from "hono";
import { z } from "zod";
import { planeFetch } from "../plane/client";
import { HttpError } from "../plane/errors";
import { projects } from "../plane/resources/projects";
import {
	deleteConfig,
	listConfigs,
	loadConfig,
	type PlaneConfigRecord,
	redactApiKey,
	saveConfig,
	validateSlug,
} from "../plane/storage";

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

function redact(cfg: PlaneConfigRecord): PlaneConfigRecord {
	return { ...cfg, apiKey: redactApiKey(cfg.apiKey) };
}

const createBody = z.object({
	slug: z.string(),
	displayName: z.string().min(1),
	planeWorkspaceSlug: z.string().min(1),
	apiKey: z.string().min(1),
	baseUrl: z.string().url().optional(),
	projectId: z.string().optional(),
	projectName: z.string().optional(),
	projectIdentifier: z.string().optional(),
});

const probeBody = z.object({
	planeWorkspaceSlug: z.string().min(1),
	apiKey: z.string().min(1),
	baseUrl: z.string().url().optional(),
});

const patchBody = z.object({
	displayName: z.string().min(1).optional(),
	planeWorkspaceSlug: z.string().min(1).optional(),
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().url().optional(),
	// projectId: null clears the pin (all-projects mode).
	projectId: z.string().nullable().optional(),
	projectName: z.string().nullable().optional(),
	projectIdentifier: z.string().nullable().optional(),
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
	const record: PlaneConfigRecord = {
		slug: parsed.data.slug,
		displayName: parsed.data.displayName,
		planeWorkspaceSlug: parsed.data.planeWorkspaceSlug,
		apiKey: parsed.data.apiKey,
		baseUrl: parsed.data.baseUrl,
		projectId: parsed.data.projectId,
		projectName: parsed.data.projectName,
		projectIdentifier: parsed.data.projectIdentifier,
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
	const { projectId, projectName, projectIdentifier, ...rest } = parsed.data;
	const updated: PlaneConfigRecord = {
		...cfg,
		...rest,
		updatedAt: new Date().toISOString(),
	};
	if (projectId !== undefined) {
		if (projectId === null) {
			updated.projectId = undefined;
			updated.projectName = undefined;
			updated.projectIdentifier = undefined;
		} else {
			updated.projectId = projectId;
			updated.projectName = projectName ?? undefined;
			updated.projectIdentifier = projectIdentifier ?? undefined;
		}
	}
	await saveConfig(c.env, userId, updated);
	return c.json(redact(updated));
});

apiApp.post("/configs/probe-projects", async (c) => {
	const parsed = probeBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
	}
	const baseUrl = parsed.data.baseUrl ?? "https://api.plane.so";
	try {
		const response = await projects.list(
			{ baseUrl, apiKey: parsed.data.apiKey },
			parsed.data.planeWorkspaceSlug,
			{ per_page: 100 },
		);
		const list = response.results.map((p) => ({
			id: p.id,
			name: p.name,
			identifier: p.identifier,
		}));
		return c.json(list);
	} catch (err) {
		const message =
			err instanceof HttpError
				? `${err.status} ${err.message}`
				: err instanceof Error
					? err.message
					: "unknown error";
		return c.json({ error: message }, 502);
	}
});

apiApp.get("/configs/:slug/projects", async (c) => {
	const userId = c.get("userId");
	const cfg = await loadConfig(c.env, userId, c.req.param("slug"));
	if (!cfg) return c.json({ error: "not found" }, 404);
	const baseUrl = cfg.baseUrl ?? "https://api.plane.so";
	try {
		const response = await projects.list(
			{ baseUrl, apiKey: cfg.apiKey },
			cfg.planeWorkspaceSlug,
			{ per_page: 100 },
		);
		const list = response.results.map((p) => ({
			id: p.id,
			name: p.name,
			identifier: p.identifier,
		}));
		return c.json(list);
	} catch (err) {
		const message =
			err instanceof HttpError
				? `${err.status} ${err.message}`
				: err instanceof Error
					? err.message
					: "unknown error";
		return c.json({ error: message }, 502);
	}
});

apiApp.delete("/configs/:slug", async (c) => {
	const userId = c.get("userId");
	await deleteConfig(c.env, userId, c.req.param("slug"));
	return new Response(null, { status: 204 });
});

apiApp.post("/configs/:slug/test", async (c) => {
	const userId = c.get("userId");
	const cfg = await loadConfig(c.env, userId, c.req.param("slug"));
	if (!cfg) return c.json({ error: "not found" }, 404);
	const baseUrl = cfg.baseUrl ?? "https://api.plane.so";
	const path = `/workspaces/${cfg.planeWorkspaceSlug}/members`;
	console.log(
		`[test] slug=${cfg.slug} baseUrl=${baseUrl} workspace=${cfg.planeWorkspaceSlug} apiKey=${redactApiKey(cfg.apiKey)}`,
	);
	try {
		await planeFetch({ baseUrl, apiKey: cfg.apiKey }, "GET", path);
		return c.json({ ok: true });
	} catch (err) {
		console.error(`[test] slug=${cfg.slug} failed:`, err);
		const message =
			err instanceof HttpError
				? `${err.status} ${err.message} on ${baseUrl}/api/v1${path}/ — ${
						typeof err.payload === "string"
							? err.payload.slice(0, 200)
							: (JSON.stringify(err.payload)?.slice(0, 200) ?? "")
					}`
				: err instanceof Error
					? err.message
					: "unknown error";
		return c.json({ ok: false, error: message });
	}
});

export { apiApp };
