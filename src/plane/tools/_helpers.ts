import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { PlaneError } from "../errors";
import { type EnrichOptions, type EntityKind, enrichWithUrl } from "../url";

/**
 * Build the zod shape fragment for a project_id parameter.
 * When the config is pinned to a project, returns an empty fragment
 * so the parameter disappears from the tool's schema. Otherwise
 * returns { project_id: z.string()... } with the given description / optionality.
 */
export function projectIdField(
	ctx: PlaneAppContext,
	options: { optional?: boolean; description?: string } = {},
): Record<string, z.ZodTypeAny> {
	if (ctx.projectId) return {};
	const desc = options.description ?? "UUID of the project";
	const field = options.optional
		? z.string().optional().describe(desc)
		: z.string().describe(desc);
	return { project_id: field };
}

export function resolveProjectId(
	ctx: PlaneAppContext,
	params: Record<string, unknown>,
): string | undefined {
	if (ctx.projectId) return ctx.projectId;
	const fromParams = params.project_id;
	return typeof fromParams === "string" ? fromParams : undefined;
}

export function requireProjectId(
	ctx: PlaneAppContext,
	params: Record<string, unknown>,
): string {
	const id = resolveProjectId(ctx, params);
	if (!id) throw new Error("project_id is required");
	return id;
}

export interface ToolTextResult {
	content: { type: "text"; text: string }[];
	isError?: boolean;
	[key: string]: unknown;
}

/**
 * Same as `toolResult` but post-processes the result through `enrichWithUrl`
 * to inject a `web_url` field on the returned entity / array / paginated
 * response. Use this on create/list/get tools whose return shape carries the
 * given entity `kind`.
 */
export async function toolResultWithUrl<T>(
	kind: EntityKind,
	ctx: PlaneAppContext,
	fn: () => Promise<T>,
	opts?: EnrichOptions,
): Promise<ToolTextResult> {
	return toolResult(async () => enrichWithUrl(kind, ctx, await fn(), opts));
}

export async function toolResult<T>(
	fn: () => Promise<T>,
): Promise<ToolTextResult> {
	try {
		const result = await fn();
		const text =
			result === undefined || result === null
				? "(no content)"
				: typeof result === "string"
					? result
					: JSON.stringify(result, null, 2);
		return { content: [{ type: "text", text }] };
	} catch (err) {
		const message =
			err instanceof PlaneError
				? `${err.name}: ${err.message}${
						"payload" in err && (err as unknown as { payload: unknown }).payload
							? `\n${JSON.stringify((err as unknown as { payload: unknown }).payload, null, 2)}`
							: ""
					}`
				: err instanceof Error
					? err.message
					: String(err);
		return { content: [{ type: "text", text: message }], isError: true };
	}
}

export function stripNullish<T extends Record<string, unknown>>(
	obj: T,
): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined && v !== null) out[k] = v;
	}
	return out as Partial<T>;
}
