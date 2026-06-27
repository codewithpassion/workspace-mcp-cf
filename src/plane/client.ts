import { ConfigurationError, HttpError } from "./errors";

export interface PlaneConfig {
	baseUrl: string;
	apiKey?: string;
	accessToken?: string;
	timeoutMs?: number;
}

export interface PlaneAppContext {
	config: PlaneConfig;
	workspaceSlug: string;
	projectId?: string;
	/** Plane web app base URL (no trailing slash) — used to build `web_url` fields in tool results. */
	appBaseUrl: string;
}

export interface PlaneRequestOptions {
	params?: Record<string, unknown> | null;
	body?: unknown;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_TOTAL = 3;
const RETRY_BASE_MS = 300;
const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(config: PlaneConfig, path: string): string {
	const base = config.baseUrl.replace(/\/+$/, "");
	const trimmed = path.replace(/^\/+/, "");
	const withTrailing = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
	return `${base}/api/v1/${withTrailing}`;
}

function buildQuery(params?: Record<string, unknown> | null): string {
	if (!params) return "";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			for (const v of value) {
				if (v !== undefined && v !== null) search.append(key, String(v));
			}
		} else if (typeof value === "object") {
			search.append(key, JSON.stringify(value));
		} else {
			search.append(key, String(value));
		}
	}
	const qs = search.toString();
	return qs ? `?${qs}` : "";
}

function buildHeaders(config: PlaneConfig, hasBody: boolean): Headers {
	const headers = new Headers();
	if (hasBody) headers.set("Content-Type", "application/json");
	headers.set("Accept", "application/json");
	if (config.apiKey) headers.set("X-API-Key", config.apiKey);
	if (config.accessToken)
		headers.set("Authorization", `Bearer ${config.accessToken}`);
	return headers;
}

async function parseError(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function parseBody(response: Response): Promise<unknown> {
	if (response.status === 204) return undefined;
	const text = await response.text();
	if (!text) return undefined;
	const contentType = response.headers.get("content-type") || "";
	if (contentType.toLowerCase().includes("application/json")) {
		return JSON.parse(text);
	}
	return text;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function planeFetch<T = unknown>(
	config: PlaneConfig,
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
	path: string,
	options: PlaneRequestOptions = {},
): Promise<T> {
	if (!config.apiKey && !config.accessToken) {
		throw new ConfigurationError(
			"Either 'apiKey' or 'accessToken' must be provided for authentication",
		);
	}
	if (config.apiKey && config.accessToken) {
		throw new ConfigurationError(
			"Only one of 'apiKey' or 'accessToken' should be provided, not both",
		);
	}

	const url = `${buildUrl(config, path)}${buildQuery(options.params)}`;
	const hasBody =
		options.body !== undefined &&
		options.body !== null &&
		method !== "GET" &&
		method !== "DELETE";
	const headers = buildHeaders(config, hasBody);
	const body = hasBody ? JSON.stringify(options.body) : undefined;
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_TOTAL; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response;
		try {
			console.log(`[plane] ${method} ${url}`);
			response = await fetch(url, {
				method,
				headers,
				body,
				signal: controller.signal,
			});
			console.log(`[plane] ${method} ${url} -> ${response.status}`);
		} catch (err) {
			lastError = err;
			clearTimeout(timer);
			if (attempt < RETRY_TOTAL) {
				await sleep(RETRY_BASE_MS * 2 ** attempt);
				continue;
			}
			throw err;
		}
		clearTimeout(timer);

		if (response.ok) {
			return (await parseBody(response)) as T;
		}

		if (RETRY_STATUS.has(response.status) && attempt < RETRY_TOTAL) {
			const retryAfter = response.headers.get("Retry-After");
			const delay = retryAfter
				? Number.parseInt(retryAfter, 10) * 1000 || RETRY_BASE_MS * 2 ** attempt
				: RETRY_BASE_MS * 2 ** attempt;
			await sleep(delay);
			continue;
		}

		const payload = await parseError(response);
		console.log(
			`[plane] ${method} ${url} error payload:`,
			typeof payload === "string" ? payload.slice(0, 500) : payload,
		);
		throw new HttpError(response.status, response.statusText, payload);
	}

	throw lastError instanceof Error
		? lastError
		: new Error("plane request failed");
}
