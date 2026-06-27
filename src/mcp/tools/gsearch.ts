// Google Custom Search (PSE) tools — 2 tools for the `gsearch` service.
//
// Unlike other Google service modules, Custom Search authenticates via
// API key (GOOGLE_PSE_API_KEY) + Engine ID (GOOGLE_PSE_ENGINE_ID) as
// query parameters, NOT via a Bearer access token. `ctx.getService("gsearch")`
// is still called to enforce the enabled-services gate and to obtain the
// account email for response formatting.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../google-service";

// ─── API base URL ──────────────────────────────────────────────────────────────

const PSE_BASE = "https://customsearch.googleapis.com/customsearch/v1";

// ─── Env extension for PSE secrets ────────────────────────────────────────────
// GOOGLE_PSE_API_KEY and GOOGLE_PSE_ENGINE_ID are not in the generated Env
// type (they're not Wrangler bindings). We widen via intersection — no `any`.

type PseEnv = Env & {
	GOOGLE_PSE_API_KEY?: string;
	GOOGLE_PSE_ENGINE_ID?: string;
};

// ─── URL builder (omits null/undefined params) ────────────────────────────────

function buildUrl(
	base: string,
	params: Record<string, string | number | boolean | null | undefined>,
): string {
	const url = new URL(base);
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
	}
	return url.toString();
}

// ─── Typed fetch for Custom Search API (API key, not Bearer) ─────────────────

async function pseFetch(url: string): Promise<unknown> {
	const resp = await fetch(url);
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`Google Custom Search API ${resp.status}: ${body}`);
	}
	return resp.json();
}

// ─── Response types ────────────────────────────────────────────────────────────

interface MetaTag {
	"og:type"?: string;
	"article:published_time"?: string;
	[key: string]: string | undefined;
}

interface PageMap {
	metatags?: MetaTag[];
}

interface SearchResultItem {
	title?: string;
	link?: string;
	snippet?: string;
	pagemap?: PageMap;
}

interface SearchInformation {
	totalResults?: string;
	searchTime?: number;
}

interface NextPageQuery {
	startIndex?: number;
}

interface SearchResponse {
	searchInformation?: SearchInformation;
	items?: SearchResultItem[];
	queries?: { nextPage?: NextPageQuery[] };
	context?: {
		title?: string;
		facets?: Array<Array<{ label?: string; anchor?: string }>>;
	};
}

// ─── Register function ─────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. search_custom ──────────────────────────────────────────────────────
	server.tool(
		"search_custom",
		"Search via Google Programmable Search Engine (PSE). Supports full-text and image search, site restriction, date filtering, and pagination.",
		{
			q: z.string().describe("The search query. Required."),
			num: z
				.number()
				.int()
				.default(10)
				.describe("Number of results to return (1–10). Defaults to 10."),
			start: z
				.number()
				.int()
				.default(1)
				.describe(
					"1-based index of the first result to return. Defaults to 1.",
				),
			safe: z
				.enum(["active", "moderate", "off"])
				.default("off")
				.describe('Safe search level. Defaults to "off".'),
			search_type: z
				.enum(["image"])
				.optional()
				.describe('Set to "image" to search for images.'),
			site_search: z
				.string()
				.optional()
				.describe("Restrict search to a specific site or domain."),
			site_search_filter: z
				.enum(["e", "i"])
				.optional()
				.describe(
					'Use with site_search: "e" excludes the site, "i" includes only the site.',
				),
			date_restrict: z
				.string()
				.optional()
				.describe(
					'Restrict results by recency (e.g. "d5" = last 5 days, "m3" = last 3 months).',
				),
			file_type: z
				.string()
				.optional()
				.describe('Filter by file type (e.g. "pdf", "doc").'),
			language: z
				.string()
				.optional()
				.describe('Language code for results (e.g. "lang_en").'),
			country: z
				.string()
				.optional()
				.describe('Country code for results (e.g. "countryUS").'),
			sites: z
				.array(z.string())
				.optional()
				.describe(
					"List of sites/domains to restrict search to. Generates a site:x OR site:y query expansion.",
				),
		},
		async ({
			q,
			num,
			start,
			safe,
			search_type,
			site_search,
			site_search_filter,
			date_restrict,
			file_type,
			language,
			country,
			sites,
		}) => {
			const { accountEmail } = await ctx.getService("gsearch");

			const pseEnv = ctx.env as PseEnv;
			const apiKey = pseEnv.GOOGLE_PSE_API_KEY;
			const cx = pseEnv.GOOGLE_PSE_ENGINE_ID;

			if (!apiKey) {
				return {
					content: [
						{
							type: "text" as const,
							text: "GOOGLE_PSE_API_KEY is not configured. Please set this secret in your Cloudflare Worker environment.",
						},
					],
				};
			}
			if (!cx) {
				return {
					content: [
						{
							type: "text" as const,
							text: "GOOGLE_PSE_ENGINE_ID is not configured. Please set this secret in your Cloudflare Worker environment.",
						},
					],
				};
			}

			// Apply site restriction via query expansion (sites param takes precedence
			// over site_search; both can coexist but are independent mechanisms).
			let effectiveQuery = q;
			if (sites && sites.length > 0) {
				const siteQuery = sites.map((s) => `site:${s}`).join(" OR ");
				effectiveQuery = `${q} (${siteQuery})`;
			}

			const urlParams: Record<
				string,
				string | number | boolean | null | undefined
			> = {
				key: apiKey,
				cx,
				q: effectiveQuery,
				num,
				start,
				safe,
			};

			if (search_type) urlParams.searchType = search_type;
			if (site_search) urlParams.siteSearch = site_search;
			if (site_search_filter) urlParams.siteSearchFilter = site_search_filter;
			if (date_restrict) urlParams.dateRestrict = date_restrict;
			if (file_type) urlParams.fileType = file_type;
			if (language) urlParams.lr = language;
			if (country) urlParams.cr = country;

			const url = buildUrl(PSE_BASE, urlParams);
			const result = (await pseFetch(url)) as SearchResponse;

			const searchInfo = result.searchInformation ?? {};
			const totalResults = searchInfo.totalResults ?? "0";
			const searchTime = searchInfo.searchTime ?? 0;
			const items = result.items ?? [];

			const lines: string[] = [
				`Search Results for ${accountEmail}:`,
				`- Query: "${effectiveQuery}"`,
				`- Search Engine ID: ${cx}`,
				`- Total Results: ${totalResults}`,
				`- Search Time: ${searchTime.toFixed(3)} seconds`,
				`- Results Returned: ${items.length} (showing ${start} to ${start + items.length - 1})`,
				"",
			];

			if (items.length > 0) {
				lines.push("Results:");
				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const idx = start + i;
					const title = item.title ?? "No title";
					const link = item.link ?? "No link";
					const snippet = (item.snippet ?? "No description available").replace(
						/\n/g,
						" ",
					);

					lines.push(`\n${idx}. ${title}`);
					lines.push(`   URL: ${link}`);
					lines.push(`   Snippet: ${snippet}`);

					if (item.pagemap?.metatags && item.pagemap.metatags.length > 0) {
						const metatag = item.pagemap.metatags[0];
						if (metatag["og:type"]) {
							lines.push(`   Type: ${metatag["og:type"]}`);
						}
						if (metatag["article:published_time"]) {
							lines.push(
								`   Published: ${metatag["article:published_time"].slice(0, 10)}`,
							);
						}
					}
				}
			} else {
				lines.push("\nNo results found.");
			}

			const nextPage = result.queries?.nextPage;
			if (nextPage && nextPage.length > 0) {
				const nextStart = nextPage[0].startIndex;
				if (nextStart !== undefined) {
					lines.push(
						`\n\nTo see more results, search again with start=${nextStart}`,
					);
				}
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_search_engine_info ─────────────────────────────────────────────
	server.tool(
		"get_search_engine_info",
		"Retrieve metadata about the configured Programmable Search Engine: its title, available refinements (facets), and total indexed result count.",
		{},
		async () => {
			const { accountEmail } = await ctx.getService("gsearch");

			const pseEnv = ctx.env as PseEnv;
			const apiKey = pseEnv.GOOGLE_PSE_API_KEY;
			const cx = pseEnv.GOOGLE_PSE_ENGINE_ID;

			if (!apiKey) {
				return {
					content: [
						{
							type: "text" as const,
							text: "GOOGLE_PSE_API_KEY is not configured. Please set this secret in your Cloudflare Worker environment.",
						},
					],
				};
			}
			if (!cx) {
				return {
					content: [
						{
							type: "text" as const,
							text: "GOOGLE_PSE_ENGINE_ID is not configured. Please set this secret in your Cloudflare Worker environment.",
						},
					],
				};
			}

			// Minimal query to extract context metadata (mirrors Python: q="test", num=1).
			const url = buildUrl(PSE_BASE, { key: apiKey, cx, q: "test", num: 1 });
			const result = (await pseFetch(url)) as SearchResponse;

			const context = result.context ?? {};
			const title = context.title ?? "Unknown";

			const lines: string[] = [
				`Search Engine Information for ${accountEmail}:`,
				`- Search Engine ID: ${cx}`,
				`- Title: ${title}`,
			];

			if (context.facets && context.facets.length > 0) {
				lines.push("\nAvailable Refinements:");
				for (const facet of context.facets) {
					for (const item of facet) {
						const label = item.label ?? "Unknown";
						const anchor = item.anchor ?? "Unknown";
						lines.push(`  - ${label} (anchor: ${anchor})`);
					}
				}
			}

			const searchInfo = result.searchInformation;
			if (searchInfo) {
				const totalResults = searchInfo.totalResults ?? "Unknown";
				lines.push("\nSearch Statistics:");
				lines.push(`  - Total indexed results: ${totalResults}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);
}
