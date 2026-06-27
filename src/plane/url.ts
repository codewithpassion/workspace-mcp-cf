import type { PlaneAppContext } from "./client";

export type EntityKind =
	| "project"
	| "work_item"
	| "cycle"
	| "module"
	| "page"
	| "workspace_page"
	| "epic"
	| "initiative";

/**
 * Derive the Plane web app base URL (no trailing slash) from the API base URL.
 * - Cloud: `https://api.plane.so` → `https://app.plane.so`.
 * - Self-hosted: same host as the API (Plane serves UI + `/api/v1` from one host).
 */
export function deriveAppBaseUrl(apiBaseUrl: string | undefined): string {
	const raw = apiBaseUrl ?? "https://api.plane.so";
	try {
		const u = new URL(raw);
		if (u.hostname === "api.plane.so") u.hostname = "app.plane.so";
		return `${u.protocol}//${u.host}`;
	} catch {
		return "https://app.plane.so";
	}
}

interface UrlIds {
	id: string;
	projectId?: string;
}

function buildEntityUrl(
	kind: EntityKind,
	appBaseUrl: string,
	workspaceSlug: string,
	ids: UrlIds,
): string | undefined {
	if (!ids.id) return undefined;
	const ws = `${appBaseUrl}/${workspaceSlug}`;
	switch (kind) {
		case "project":
			return `${ws}/projects/${ids.id}/`;
		case "workspace_page":
			return `${ws}/pages/${ids.id}/`;
		case "initiative":
			return `${ws}/initiatives/${ids.id}/`;
	}
	if (!ids.projectId) return undefined;
	switch (kind) {
		case "work_item":
			return `${ws}/projects/${ids.projectId}/work-items/${ids.id}/`;
		case "cycle":
			return `${ws}/projects/${ids.projectId}/cycles/${ids.id}/`;
		case "module":
			return `${ws}/projects/${ids.projectId}/modules/${ids.id}/`;
		case "page":
			return `${ws}/projects/${ids.projectId}/pages/${ids.id}/`;
		case "epic":
			return `${ws}/projects/${ids.projectId}/epics/${ids.id}/`;
	}
}

export interface EnrichOptions {
	/** Override project id (otherwise: entity.project → ctx.projectId). */
	projectId?: string;
}

function enrichOne(
	kind: EntityKind,
	ctx: PlaneAppContext,
	entity: unknown,
	opts?: EnrichOptions,
): unknown {
	if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
		return entity;
	}
	const e = entity as Record<string, unknown>;
	if (typeof e.web_url === "string" && e.web_url.length > 0) return e;
	const id = typeof e.id === "string" ? e.id : undefined;
	if (!id) return e;
	const projectFromEntity =
		typeof e.project === "string" ? (e.project as string) : undefined;
	const projectId = opts?.projectId ?? projectFromEntity ?? ctx.projectId;
	const url = buildEntityUrl(kind, ctx.appBaseUrl, ctx.workspaceSlug, {
		id,
		projectId,
	});
	if (!url) return e;
	return { ...e, web_url: url };
}

/**
 * Inject a `web_url` property into Plane API return values. Accepts:
 *  - a single entity object (returned with `web_url` added)
 *  - an array of entities (each enriched)
 *  - a paginated response `{ results: [...] }` (each item in `results` enriched)
 *
 * Already-present `web_url` strings are preserved (not overwritten).
 */
export function enrichWithUrl<T>(
	kind: EntityKind,
	ctx: PlaneAppContext,
	value: T,
	opts?: EnrichOptions,
): T {
	if (value == null) return value;
	if (Array.isArray(value)) {
		return value.map((v) => enrichOne(kind, ctx, v, opts)) as unknown as T;
	}
	if (typeof value === "object") {
		const v = value as Record<string, unknown>;
		if (Array.isArray(v.results)) {
			return {
				...v,
				results: v.results.map((r) => enrichOne(kind, ctx, r, opts)),
			} as unknown as T;
		}
		return enrichOne(kind, ctx, value, opts) as unknown as T;
	}
	return value;
}
