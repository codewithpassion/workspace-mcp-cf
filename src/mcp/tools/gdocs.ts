// Google Docs tools — 20 tools for the `gdocs` service.
//
// Module pattern (same for all service modules):
//   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//   import { z } from "zod";
//   import { googleApiFetch, type ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// API bases:
//   Docs API:  https://docs.googleapis.com/v1
//   Drive API: https://www.googleapis.com/drive/v3  (file metadata, export, comments)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";
import {
	analyzeDoc,
	buildEndOfSegmentLocation,
	buildLocation,
	buildParagraphStyleAndFields,
	buildRange,
	buildTextStyleAndFields,
	buildUrl,
	type DocumentResponse,
	docToMarkdown,
	extractDocText,
	findTablesInContent,
	operationToRequests,
	type TableInfo,
} from "./gdocs-helpers";

// ─── API base URLs ─────────────────────────────────────────────────────────────

const DOCS_BASE = "https://docs.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

// ─── Authenticated fetch aliases ───────────────────────────────────────────────

const docsFetch = googleApiFetch;
const driveFetch = googleApiFetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DOCS_LINK = (docId: string) =>
	`https://docs.google.com/document/d/${docId}/edit`;

/** Execute a Docs API batchUpdate. Returns the parsed response. */
async function batchUpdate(
	accessToken: string,
	docId: string,
	requests: unknown[],
): Promise<{
	replies?: unknown[];
	writeControl?: unknown;
	documentId?: string;
}> {
	return (await docsFetch(
		accessToken,
		`${DOCS_BASE}/documents/${encodeURIComponent(docId)}:batchUpdate`,
		{ method: "POST", body: JSON.stringify({ requests }) },
	)) as { replies?: unknown[]; writeControl?: unknown; documentId?: string };
}

/** Upload PDF bytes to Drive using multipart upload. Returns file metadata. */
async function uploadPdfToDrive(
	accessToken: string,
	pdfBytes: Uint8Array,
	filename: string,
	folderId?: string,
): Promise<{ id?: string; webViewLink?: string; name?: string }> {
	const boundary = "---GDocsMCPBoundary7f8d9e0a";
	const meta: Record<string, unknown> = {
		name: filename,
		mimeType: "application/pdf",
	};
	if (folderId) meta.parents = [folderId];
	const metaStr = JSON.stringify(meta);
	const enc = new TextEncoder();
	const p1 = enc.encode(
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaStr}\r\n`,
	);
	const p2 = enc.encode(
		`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
	);
	const p3 = enc.encode(`\r\n--${boundary}--`);
	const total =
		p1.byteLength + p2.byteLength + pdfBytes.byteLength + p3.byteLength;
	const body = new Uint8Array(total);
	let off = 0;
	body.set(p1, off);
	off += p1.byteLength;
	body.set(p2, off);
	off += p2.byteLength;
	body.set(pdfBytes, off);
	off += pdfBytes.byteLength;
	body.set(p3, off);
	return (await driveFetch(
		accessToken,
		`${DRIVE_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`,
		{
			method: "POST",
			headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
			body,
		},
	)) as { id?: string; webViewLink?: string; name?: string };
}

/** Upsert the default header or footer for a document.
 *  Returns { segmentId, created } where created=true if it was newly created.
 */
async function upsertHeaderFooter(
	accessToken: string,
	docId: string,
	sectionType: "header" | "footer",
	hfType: string,
	content: string,
): Promise<string> {
	// Map (sectionType, hfType) → documentStyle field name
	const styleFieldMap: Record<string, Record<string, string>> = {
		header: {
			DEFAULT: "defaultHeaderId",
			FIRST_PAGE_ONLY: "firstPageHeaderId",
			EVEN_PAGE: "evenPageHeaderId",
		},
		footer: {
			DEFAULT: "defaultFooterId",
			FIRST_PAGE_ONLY: "firstPageFooterId",
			EVEN_PAGE: "evenPageFooterId",
		},
	};
	const styleField =
		styleFieldMap[sectionType]?.[hfType] ??
		(sectionType === "header" ? "defaultHeaderId" : "defaultFooterId");

	// Fetch the doc to check existing segment
	const doc = (await docsFetch(
		accessToken,
		`${DOCS_BASE}/documents/${encodeURIComponent(docId)}?fields=documentStyle,headers,footers`,
	)) as DocumentResponse & {
		documentStyle?: Record<string, unknown>;
		headers?: Record<string, unknown>;
		footers?: Record<string, unknown>;
	};

	let segmentId = doc.documentStyle?.[styleField] as string | undefined;

	if (!segmentId) {
		// Create header/footer
		const createKey =
			sectionType === "header" ? "createHeader" : "createFooter";
		const createResult = await batchUpdate(accessToken, docId, [
			{ [createKey]: { type: hfType } },
		]);
		const reply = (
			createResult.replies as Array<Record<string, unknown>> | undefined
		)?.[0];
		const replyData = reply?.[createKey] as Record<string, unknown> | undefined;
		segmentId = (replyData?.headerId ?? replyData?.footerId) as
			| string
			| undefined;
		if (!segmentId)
			throw new Error(
				`Failed to create ${sectionType}: no segment ID in response`,
			);
	} else {
		// Clear existing content (segment exists)
		const segments = (sectionType === "header" ? doc.headers : doc.footers) as
			| Record<string, unknown>
			| undefined;
		const segment = segments?.[segmentId] as
			| Record<string, unknown>
			| undefined;
		const segContent = segment?.content as
			| Array<{ startIndex?: number; endIndex?: number }>
			| undefined;
		if (segContent && segContent.length > 0) {
			const lastEndIndex = segContent[segContent.length - 1].endIndex ?? 0;
			if (lastEndIndex > 2) {
				await batchUpdate(accessToken, docId, [
					{
						deleteContentRange: {
							range: buildRange(1, lastEndIndex - 1, undefined, segmentId),
						},
					},
				]);
			}
		}
	}

	// Insert new content
	await batchUpdate(accessToken, docId, [
		{
			insertText: {
				location: buildLocation(1, undefined, segmentId),
				text: content,
			},
		},
	]);

	return segmentId;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. search_docs ────────────────────────────────────────────────────────
	server.tool(
		"search_docs",
		"Search for Google Docs by name. Returns file IDs, names, modified times, and links.",
		{
			query: z
				.string()
				.optional()
				.describe("Search query to match against document names."),
			folder_id: z
				.string()
				.optional()
				.describe("Limit search to files in this Drive folder ID."),
			page_size: z
				.number()
				.int()
				.default(10)
				.describe("Max results to return (default 10)."),
			page_token: z
				.string()
				.optional()
				.describe("Pagination token from a previous search."),
		},
		async ({ query, folder_id, page_size, page_token }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const qParts = [
				"mimeType='application/vnd.google-apps.document'",
				"trashed=false",
			];
			if (query) {
				const escaped = query.replace(/'/g, "\\'");
				qParts.push(`name contains '${escaped}'`);
			}
			if (folder_id) qParts.push(`'${folder_id}' in parents`);
			const url = buildUrl(`${DRIVE_BASE}/files`, {
				q: qParts.join(" and "),
				pageSize: page_size,
				fields:
					"files(id,name,createdTime,modifiedTime,webViewLink),nextPageToken",
				supportsAllDrives: true,
				includeItemsFromAllDrives: true,
				pageToken: page_token,
			});
			const data = (await driveFetch(accessToken, url)) as {
				files?: Array<{
					id: string;
					name: string;
					modifiedTime?: string;
					webViewLink?: string;
				}>;
				nextPageToken?: string;
			};
			const files = data.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No Google Docs found${query ? ` matching '${query}'` : ""}.`,
						},
					],
				};
			}
			const lines = [
				`Found ${files.length} Google Doc(s)${query ? ` matching '${query}'` : ""}:`,
			];
			for (const f of files) {
				lines.push(
					`- ${f.name} (ID: ${f.id}) Modified: ${f.modifiedTime ?? "N/A"} Link: ${f.webViewLink ?? "N/A"}`,
				);
			}
			if (data.nextPageToken)
				lines.push(`\nnextPageToken: ${data.nextPageToken}`);
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_doc_content ───────────────────────────────────────────────────
	server.tool(
		"get_doc_content",
		"Get the text content of a Google Doc or Drive file (DOCX, TXT). Returns plain text with a metadata header.",
		{
			document_id: z.string().describe("Google Doc ID or Drive file ID."),
			suggestions_view_mode: z
				.enum([
					"DEFAULT_FOR_CURRENT_ACCESS",
					"SUGGESTIONS_INLINE",
					"PREVIEW_SUGGESTIONS_ACCEPTED",
					"PREVIEW_WITHOUT_SUGGESTIONS",
				])
				.default("DEFAULT_FOR_CURRENT_ACCESS")
				.describe("How to render tracked suggestions in the content."),
		},
		async ({ document_id, suggestions_view_mode }) => {
			const { accessToken } = await ctx.getService("gdocs");

			// Get file metadata
			const fileMeta = (await driveFetch(
				accessToken,
				buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}`, {
					fields: "id,name,mimeType,webViewLink",
					supportsAllDrives: true,
				}),
			)) as {
				id?: string;
				name?: string;
				mimeType?: string;
				webViewLink?: string;
			};

			const mimeType = fileMeta.mimeType ?? "";
			const fileName = fileMeta.name ?? "Unknown";
			const webViewLink = fileMeta.webViewLink ?? "#";
			const header = `File: "${fileName}" (ID: ${document_id}, Type: ${mimeType})\nLink: ${webViewLink}\n\n--- CONTENT ---\n`;

			if (mimeType === "application/vnd.google-apps.document") {
				const doc = (await docsFetch(
					accessToken,
					buildUrl(
						`${DOCS_BASE}/documents/${encodeURIComponent(document_id)}`,
						{
							includeTabsContent: true,
							suggestionsViewMode: suggestions_view_mode,
						},
					),
				)) as DocumentResponse;
				const bodyText = extractDocText(doc);
				return {
					content: [{ type: "text" as const, text: header + bodyText }],
				};
			}

			// Non-native: try text export first (for text-exportable types), then raw download
			const exportableMimes: Record<string, string> = {
				"application/vnd.google-apps.spreadsheet": "text/csv",
				"application/vnd.google-apps.presentation": "text/plain",
			};
			const exportMime = exportableMimes[mimeType];
			const downloadUrl = exportMime
				? buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}/export`,
						{ mimeType: exportMime },
					)
				: buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}`, {
						alt: "media",
						supportsAllDrives: true,
					});

			const resp = await fetch(downloadUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (!resp.ok) {
				throw new Error(
					`Failed to download file: ${resp.status} ${await resp.text()}`,
				);
			}
			const bytes = new Uint8Array(await resp.arrayBuffer());

			// Try UTF-8 decode; note that Office XML extraction is not available in Workers
			let bodyText: string;
			try {
				bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				bodyText = `[Binary content (${bytes.byteLength} bytes) — Office XML/PDF text extraction is not supported in this runtime. Use the Drive export API to obtain a text/plain export for supported file types.]`;
			}
			return { content: [{ type: "text" as const, text: header + bodyText }] };
		},
	);

	// ── 3. list_docs_in_folder ───────────────────────────────────────────────
	server.tool(
		"list_docs_in_folder",
		"List all Google Docs in a specific Drive folder.",
		{
			folder_id: z
				.string()
				.describe("Drive folder ID (use 'root' for My Drive)."),
			page_size: z
				.number()
				.int()
				.default(20)
				.describe("Max results (default 20)."),
			page_token: z.string().optional().describe("Pagination token."),
		},
		async ({ folder_id, page_size, page_token }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const url = buildUrl(`${DRIVE_BASE}/files`, {
				q: `'${folder_id}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
				pageSize: page_size,
				fields: "files(id,name,modifiedTime,webViewLink),nextPageToken",
				supportsAllDrives: true,
				includeItemsFromAllDrives: true,
				pageToken: page_token,
			});
			const data = (await driveFetch(accessToken, url)) as {
				files?: Array<{
					id: string;
					name: string;
					modifiedTime?: string;
					webViewLink?: string;
				}>;
				nextPageToken?: string;
			};
			const files = data.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No Google Docs found in folder '${folder_id}'.`,
						},
					],
				};
			}
			const lines = [`Found ${files.length} Doc(s) in folder '${folder_id}':`];
			for (const f of files) {
				lines.push(
					`- ${f.name} (ID: ${f.id}) Modified: ${f.modifiedTime ?? "N/A"} Link: ${f.webViewLink ?? "N/A"}`,
				);
			}
			if (data.nextPageToken)
				lines.push(`\nnextPageToken: ${data.nextPageToken}`);
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 4. create_doc ────────────────────────────────────────────────────────
	server.tool(
		"create_doc",
		"Create a new Google Doc with an optional initial text content.",
		{
			title: z.string().default("Untitled").describe("Document title."),
			content: z
				.string()
				.optional()
				.describe("Optional initial plain-text content to insert."),
		},
		async ({ title, content }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const doc = (await docsFetch(accessToken, `${DOCS_BASE}/documents`, {
				method: "POST",
				body: JSON.stringify({ title }),
			})) as { documentId?: string };
			const docId = doc.documentId;
			if (!docId) throw new Error("Document creation returned no documentId.");
			if (content) {
				await batchUpdate(accessToken, docId, [
					{ insertText: { location: { index: 1 }, text: content } },
				]);
			}
			const link = DOCS_LINK(docId);
			const contentNote = content
				? `Initial content: ${content.length} characters inserted.`
				: "Document is empty (body starts at index 1, total length 2).";
			return {
				content: [
					{
						type: "text" as const,
						text: `Created Google Doc '${title}' (ID: ${docId}). ${contentNote} Use batch_update_doc with end_of_segment=true to append content. Link: ${link}`,
					},
				],
			};
		},
	);

	// ── 5. modify_doc_text ───────────────────────────────────────────────────
	server.tool(
		"modify_doc_text",
		"Insert, replace, or delete text and/or apply inline formatting at a specific position in a Google Doc. Use end_of_segment=true to append without calculating an index.",
		{
			document_id: z.string().describe("Document ID."),
			start_index: z
				.number()
				.int()
				.describe(
					"Start position (Docs API index from inspect_doc_structure; 0 is accepted as alias for 1 in the main body).",
				),
			end_index: z
				.number()
				.int()
				.optional()
				.describe("End position for replacement or formatting range."),
			text: z.string().optional().describe("Text to insert or replace with."),
			tab_id: z.string().optional().describe("Target tab ID."),
			segment_id: z
				.string()
				.optional()
				.describe(
					"Header/footer/footnote segment ID from inspect_doc_structure.",
				),
			end_of_segment: z
				.boolean()
				.default(false)
				.describe(
					"Insert at the end of the targeted segment instead of start_index.",
				),
			bold: z.boolean().optional(),
			italic: z.boolean().optional(),
			underline: z.boolean().optional(),
			strikethrough: z.boolean().optional(),
			font_size: z.number().int().optional().describe("Font size in points."),
			font_family: z
				.string()
				.optional()
				.describe("Font family name (e.g. 'Arial')."),
			font_weight: z.number().int().optional().describe("Font weight 100–900."),
			text_color: z.string().optional().describe("Foreground color (#RRGGBB)."),
			background_color: z
				.string()
				.optional()
				.describe("Background highlight color (#RRGGBB)."),
			link_url: z.string().optional().describe("Hyperlink URL."),
			clear_link: z
				.boolean()
				.optional()
				.describe("Remove hyperlink from the range."),
			baseline_offset: z
				.string()
				.optional()
				.describe("NONE, SUPERSCRIPT, or SUBSCRIPT."),
			small_caps: z.boolean().optional(),
		},
		async ({
			document_id,
			start_index,
			end_index,
			text,
			tab_id,
			segment_id,
			end_of_segment,
			bold,
			italic,
			underline,
			strikethrough,
			font_size,
			font_family,
			font_weight,
			text_color,
			background_color,
			link_url,
			clear_link,
			baseline_offset,
			small_caps,
		}) => {
			const { accessToken } = await ctx.getService("gdocs");
			const fmtOp = {
				bold,
				italic,
				underline,
				strikethrough,
				font_size,
				font_family,
				font_weight,
				text_color,
				background_color,
				link_url,
				clear_link,
				baseline_offset,
				small_caps,
			};
			const hasFormatting = Object.values(fmtOp).some((v) => v !== undefined);
			if (text === undefined && !hasFormatting) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: Must provide either 'text' or formatting parameters.",
						},
					],
				};
			}
			if (hasFormatting && end_index === undefined) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: 'end_index' is required when applying formatting.",
						},
					],
				};
			}
			if (hasFormatting && end_of_segment) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: end_of_segment cannot be used when applying formatting.",
						},
					],
				};
			}

			const requests: unknown[] = [];
			const ops: string[] = [];
			const effectiveStart =
				start_index === 0 && !end_of_segment && !segment_id && !tab_id
					? 1
					: start_index;

			if (text !== undefined) {
				if (end_index !== undefined && end_index > start_index) {
					// Replace
					if (end_of_segment) {
						return {
							content: [
								{
									type: "text" as const,
									text: "Error: end_of_segment cannot be combined with text replacement.",
								},
							],
						};
					}
					requests.push(
						{
							deleteContentRange: {
								range: buildRange(
									effectiveStart,
									end_index,
									tab_id,
									segment_id,
								),
							},
						},
						{
							insertText: {
								location: buildLocation(effectiveStart, tab_id, segment_id),
								text,
							},
						},
					);
					ops.push(`Replaced text from index ${start_index} to ${end_index}`);
				} else if (end_of_segment) {
					requests.push({
						insertText: {
							endOfSegmentLocation: buildEndOfSegmentLocation(
								tab_id,
								segment_id,
							),
							text,
						},
					});
					ops.push(`Inserted text at end of segment '${segment_id ?? "body"}'`);
				} else {
					requests.push({
						insertText: {
							location: buildLocation(effectiveStart, tab_id, segment_id),
							text,
						},
					});
					ops.push(`Inserted text at index ${start_index}`);
				}
			}

			if (hasFormatting) {
				const fStart = effectiveStart;
				let fEnd = end_index as number;
				if (text !== undefined) {
					if (end_index !== undefined && end_index > start_index) {
						fEnd = fStart + text.length;
					} else {
						fEnd = fStart + text.length;
					}
				}
				const { textStyle, fields } = buildTextStyleAndFields(fmtOp);
				if (fields) {
					requests.push({
						updateTextStyle: {
							range: buildRange(fStart, fEnd, tab_id, segment_id),
							textStyle,
							fields,
						},
					});
					ops.push(`Applied formatting to range ${fStart}-${fEnd}`);
				}
			}

			await batchUpdate(accessToken, document_id, requests);
			const textInfo =
				text !== undefined ? ` Text length: ${text.length} characters.` : "";
			return {
				content: [
					{
						type: "text" as const,
						text: `${ops.join("; ")} in document ${document_id}.${textInfo} Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 6. find_and_replace_doc ──────────────────────────────────────────────
	server.tool(
		"find_and_replace_doc",
		"Find and replace all occurrences of text in a Google Doc. No index calculation required.",
		{
			document_id: z.string(),
			find_text: z.string().describe("Text to search for."),
			replace_text: z.string().describe("Replacement text."),
			match_case: z.boolean().default(false),
			tab_id: z
				.string()
				.optional()
				.describe("Limit replacement to a specific tab."),
		},
		async ({ document_id, find_text, replace_text, match_case, tab_id }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const replaceReq: Record<string, unknown> = {
				containsText: { text: find_text, matchCase: match_case },
				replaceText: replace_text,
			};
			if (tab_id) replaceReq.tabsCriteria = { tabIds: [tab_id] };
			const result = await batchUpdate(accessToken, document_id, [
				{ replaceAllText: replaceReq },
			]);
			const replies = result.replies as
				| Array<Record<string, unknown>>
				| undefined;
			const replacements =
				(replies?.[0]?.replaceAllText as Record<string, unknown> | undefined)
					?.occurrencesChanged ?? 0;
			return {
				content: [
					{
						type: "text" as const,
						text: `Replaced ${replacements} occurrence(s) of '${find_text}' with '${replace_text}' in document ${document_id}. Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 7. insert_doc_elements ───────────────────────────────────────────────
	server.tool(
		"insert_doc_elements",
		"Insert a table, bulleted/numbered list, or page break into a Google Doc.",
		{
			document_id: z.string(),
			element_type: z
				.enum(["table", "list", "page_break"])
				.describe("Type of element to insert."),
			index: z
				.number()
				.int()
				.describe(
					"Insertion position (0 is treated as 1 to avoid the section break).",
				),
			rows: z
				.number()
				.int()
				.optional()
				.describe("Number of rows (required for table)."),
			columns: z
				.number()
				.int()
				.optional()
				.describe("Number of columns (required for table)."),
			list_type: z
				.string()
				.optional()
				.describe("'UNORDERED' or 'ORDERED' (required for list)."),
			text: z
				.string()
				.optional()
				.describe("Initial list item text (for list only)."),
		},
		async ({
			document_id,
			element_type,
			index,
			rows,
			columns,
			list_type,
			text,
		}) => {
			const { accessToken } = await ctx.getService("gdocs");
			const effectiveIndex = index === 0 ? 1 : index;
			const requests: unknown[] = [];
			let description: string;

			if (element_type === "table") {
				if (!rows || !columns) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Error: 'rows' and 'columns' are required for table insertion.",
							},
						],
					};
				}
				requests.push({
					insertTable: { rows, columns, location: { index: effectiveIndex } },
				});
				description = `table (${rows}x${columns})`;
			} else if (element_type === "list") {
				if (!list_type) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Error: 'list_type' is required for list insertion ('UNORDERED' or 'ORDERED').",
							},
						],
					};
				}
				const itemText = text ?? "List item";
				const preset =
					list_type.toUpperCase() === "ORDERED"
						? "NUMBERED_DECIMAL_ALPHA_ROMAN"
						: "BULLET_DISC_CIRCLE_SQUARE";
				requests.push(
					{
						insertText: {
							location: { index: effectiveIndex },
							text: `${itemText}\n`,
						},
					},
					{
						createParagraphBullets: {
							range: {
								startIndex: effectiveIndex,
								endIndex: effectiveIndex + itemText.length,
							},
							bulletPreset: preset,
						},
					},
				);
				description = `${list_type.toLowerCase()} list`;
			} else {
				requests.push({
					insertPageBreak: { location: { index: effectiveIndex } },
				});
				description = "page break";
			}

			await batchUpdate(accessToken, document_id, requests);
			return {
				content: [
					{
						type: "text" as const,
						text: `Inserted ${description} at index ${effectiveIndex} in document ${document_id}. Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 8. insert_doc_image ──────────────────────────────────────────────────
	server.tool(
		"insert_doc_image",
		"Insert an image into a Google Doc from a Drive file ID or a public URL.",
		{
			document_id: z.string(),
			image_source: z
				.string()
				.describe("Drive file ID or public image URL (http/https)."),
			index: z
				.number()
				.int()
				.default(1)
				.describe("Insertion position (0 → adjusted to 1)."),
			width: z
				.number()
				.optional()
				.describe("Image width in points (0 = auto)."),
			height: z
				.number()
				.optional()
				.describe("Image height in points (0 = auto)."),
		},
		async ({ document_id, image_source, index, width, height }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const effectiveIndex = index <= 0 ? 1 : index;
			let imageUri: string;
			let sourceDesc: string;

			const isDriveFile =
				!image_source.startsWith("http://") &&
				!image_source.startsWith("https://");
			if (isDriveFile) {
				const fileMeta = (await driveFetch(
					accessToken,
					buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(image_source)}`, {
						fields: "id,name,mimeType",
						supportsAllDrives: true,
					}),
				)) as { id?: string; name?: string; mimeType?: string };
				if (!fileMeta.mimeType?.startsWith("image/")) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: File ${image_source} is not an image (MIME type: ${fileMeta.mimeType}).`,
							},
						],
					};
				}
				imageUri = `https://drive.google.com/uc?id=${image_source}`;
				sourceDesc = `Drive file '${fileMeta.name ?? image_source}'`;
			} else {
				imageUri = image_source;
				sourceDesc = "URL image";
			}

			const req: Record<string, unknown> = {
				uri: imageUri,
				location: { index: effectiveIndex },
			};
			if (width || height) {
				req.objectSize = {
					...(height ? { height: { magnitude: height, unit: "PT" } } : {}),
					...(width ? { width: { magnitude: width, unit: "PT" } } : {}),
				};
			}
			await batchUpdate(accessToken, document_id, [{ insertInlineImage: req }]);
			const sizeInfo =
				width || height
					? ` (size: ${width ?? "auto"}x${height ?? "auto"} pts)`
					: "";
			return {
				content: [
					{
						type: "text" as const,
						text: `Inserted ${sourceDesc}${sizeInfo} at index ${effectiveIndex} in document ${document_id}. Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 9. update_doc_headers_footers ────────────────────────────────────────
	server.tool(
		"update_doc_headers_footers",
		"Safely create or update the header or footer of a Google Doc. Auto-creates the segment if it does not exist yet.",
		{
			document_id: z.string(),
			section_type: z
				.enum(["header", "footer"])
				.describe("'header' or 'footer'."),
			content: z.string().describe("Text content for the header/footer."),
			header_footer_type: z
				.string()
				.default("DEFAULT")
				.describe("'DEFAULT', 'FIRST_PAGE_ONLY', or 'EVEN_PAGE'."),
		},
		async ({ document_id, section_type, content, header_footer_type }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const segmentId = await upsertHeaderFooter(
				accessToken,
				document_id,
				section_type,
				header_footer_type,
				content,
			);
			return {
				content: [
					{
						type: "text" as const,
						text: `Updated ${section_type} (segment ID: ${segmentId}) in document ${document_id}. Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 10. batch_update_doc ─────────────────────────────────────────────────
	server.tool(
		"batch_update_doc",
		`Apply one or more operations to a Google Doc in a single batch. Each operation must have a 'type' field.

Supported operation types:
  insert_text        — required: text; optional: index, end_of_segment, tab_id, segment_id
  delete_text        — required: start_index, end_index
  replace_text       — required: start_index, end_index, text
  format_text        — required: start_index, end_index; optional: bold, italic, underline, strikethrough, font_size, font_family, font_weight, text_color, background_color, link_url, clear_link, baseline_offset, small_caps
  update_paragraph_style — required: start_index, end_index; optional: heading_level (0-6), named_style_type, alignment, line_spacing, indent_*, space_above, space_below, direction, keep_lines_together, keep_with_next, avoid_widow_and_orphan, page_break_before, spacing_mode, shading_color, list_type, bullet_preset
  update_table_cell_style — required: table_start_index; optional: row_index, column_index, row_span, column_span, background_color, border_color, border_width, content_alignment, padding_*
  insert_table       — required: rows, columns; optional: index, end_of_segment
  insert_table_row   — required: table_start_index, row_index; optional: insert_below (default true)
  delete_table_row   — required: table_start_index, row_index
  insert_table_column — required: table_start_index, column_index; optional: insert_right (default true)
  delete_table_column — required: table_start_index, column_index
  merge_table_cells  — required: table_start_index, row_index, column_index, row_span, column_span
  unmerge_table_cells — required: table_start_index, row_index, column_index, row_span, column_span
  update_table_column_properties — required: table_start_index, column_indices; optional: width, width_type
  insert_page_break  — optional: index, end_of_segment
  insert_section_break — optional: index, end_of_segment, section_type ('CONTINUOUS'|'NEXT_PAGE')
  find_replace       — required: find_text, replace_text; optional: match_case
  create_bullet_list — required: start_index, end_index; optional: list_type ('UNORDERED'|'ORDERED'|'CHECKBOX'|'NONE'), bullet_preset
  create_named_range — required: name, start_index, end_index
  replace_named_range_content — required: text; optional: named_range_id, named_range_name
  delete_named_range — optional: named_range_id, named_range_name
  update_document_style — optional: background_color, margin_*, page_width, page_height, page_number_start, use_even_page_header_footer, use_first_page_header_footer, flip_page_orientation
  update_section_style — required: start_index, end_index; optional: margin_*, page_number_start, content_direction, column_count
  create_header_footer — required: section_type ('header'|'footer'); optional: header_footer_type, section_break_index
  insert_image       — required: image_uri; optional: index, end_of_segment, width, height
  insert_doc_tab     — required: title, index; optional: parent_tab_id
  delete_doc_tab     — required: tab_id
  update_doc_tab     — required: tab_id, title

RECOMMENDED: Use end_of_segment=true for insert_text to append without index math.`,
		{
			document_id: z.string(),
			operations: z
				.array(z.record(z.string(), z.unknown()))
				.describe("Array of operation objects, each with a 'type' field."),
		},
		async ({ document_id, operations }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const requests: unknown[] = [];
			for (const op of operations) {
				const reqs = operationToRequests(op);
				requests.push(...reqs);
			}
			const result = await batchUpdate(accessToken, document_id, requests);
			const replies = (result.replies as unknown[] | undefined) ?? [];
			const link = DOCS_LINK(document_id);
			return {
				content: [
					{
						type: "text" as const,
						text: `Applied ${operations.length} operation(s) (${requests.length} API request(s)) to document ${document_id}. API replies: ${replies.length}. To apply formatting, call inspect_doc_structure to get exact text positions. Link: ${link}`,
					},
				],
			};
		},
	);

	// ── 11. inspect_doc_structure ────────────────────────────────────────────
	server.tool(
		"inspect_doc_structure",
		"Inspect the structure of a Google Doc to find element positions, tables, headers/footers, and tabs. Call this before index-based operations to get safe insertion indices.",
		{
			document_id: z.string(),
			detailed: z
				.boolean()
				.default(false)
				.describe("Return per-element details including text previews."),
			tab_id: z
				.string()
				.optional()
				.describe("Inspect a specific tab instead of the main body."),
		},
		async ({ document_id, detailed, tab_id }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const doc = (await docsFetch(
				accessToken,
				buildUrl(`${DOCS_BASE}/documents/${encodeURIComponent(document_id)}`, {
					includeTabsContent: true,
				}),
			)) as DocumentResponse;

			const structure = analyzeDoc(doc, tab_id);

			let result: Record<string, unknown>;
			if (detailed) {
				result = {
					title: structure.title,
					total_length: structure.totalLength,
					statistics: {
						elements: structure.elements.length,
						tables: structure.tables.length,
						paragraphs: structure.elements.filter((e) => e.type === "paragraph")
							.length,
						section_breaks: structure.sectionBreaks.length,
						has_headers: !!(doc.headers && Object.keys(doc.headers).length > 0),
						has_footers: !!(doc.footers && Object.keys(doc.footers).length > 0),
					},
					elements: structure.elements.map((e) => ({
						type: e.type,
						start_index: e.startIndex,
						end_index: e.endIndex,
						...(e.type === "paragraph" ? { text_preview: e.textPreview } : {}),
						...(e.type === "table"
							? { rows: e.rows, columns: e.columns, cell_count: e.cellCount }
							: {}),
					})),
					tables: structure.tables.map((t, i) => ({
						index: i,
						position: { start: t.startIndex, end: t.endIndex },
						dimensions: { rows: t.rows, columns: t.columns },
						preview: t.cells
							.slice(0, 3)
							.map((row) => row.map((c) => c.content.slice(0, 50))),
					})),
					...(structure.sectionBreaks.length > 0
						? { section_breaks: structure.sectionBreaks }
						: {}),
				};
			} else {
				result = {
					title: structure.title,
					total_elements: structure.elements.length,
					total_length: structure.totalLength,
					tables: structure.tables.length,
					paragraphs: structure.elements.filter((e) => e.type === "paragraph")
						.length,
					...(structure.tables.length > 0
						? {
								table_details: structure.tables.map((t, i) => ({
									index: i,
									rows: t.rows,
									columns: t.columns,
									start_index: t.startIndex,
									end_index: t.endIndex,
								})),
							}
						: {}),
				};
			}

			// Add header/footer info (from top-level doc or first tab)
			const docStyle = (doc.documentStyle ?? {}) as Record<string, unknown>;
			const hfStyleFields: Record<string, string> = {
				defaultHeaderId: "header:DEFAULT",
				firstPageHeaderId: "header:FIRST_PAGE_ONLY",
				evenPageHeaderId: "header:EVEN_PAGE",
				defaultFooterId: "footer:DEFAULT",
				firstPageFooterId: "footer:FIRST_PAGE_ONLY",
				evenPageFooterId: "footer:EVEN_PAGE",
			};
			const headerEntries: Record<string, unknown>[] = [];
			const footerEntries: Record<string, unknown>[] = [];
			for (const [field, label] of Object.entries(hfStyleFields)) {
				const segId = docStyle[field] as string | undefined;
				if (!segId) continue;
				const isHeader = label.startsWith("header:");
				const variant = label.split(":")[1];
				const entry = {
					segment_id: segId,
					variant,
					source: `documentStyle.${field}`,
				};
				if (isHeader) headerEntries.push(entry);
				else footerEntries.push(entry);
			}
			if (headerEntries.length > 0) result.headers = headerEntries;
			if (footerEntries.length > 0) result.footers = footerEntries;

			// Tabs summary (when not inspecting a specific tab)
			if (!tab_id) result.tabs = structure.tabs;
			else result.inspected_tab_id = tab_id;

			const link = DOCS_LINK(document_id);
			return {
				content: [
					{
						type: "text" as const,
						text: `Document structure for ${document_id}:\n\n${JSON.stringify(result, null, 2)}\n\nLink: ${link}`,
					},
				],
			};
		},
	);

	// ── 12. debug_docs_runtime_info ──────────────────────────────────────────
	server.tool(
		"debug_docs_runtime_info",
		"Return runtime/diagnostic information for the Google Docs MCP module. Useful for diagnosing stale or misconfigured deployments.",
		{},
		async () => {
			const info = {
				runtime_canary: "gdocs-ts-cf-20260327a",
				runtime: "Cloudflare Workers (TypeScript port)",
				docs_api_base: DOCS_BASE,
				drive_api_base: DRIVE_BASE,
				supported_operations: [
					"insert_text",
					"delete_text",
					"replace_text",
					"format_text",
					"update_paragraph_style",
					"update_table_cell_style",
					"insert_table",
					"insert_table_row",
					"delete_table_row",
					"insert_table_column",
					"delete_table_column",
					"merge_table_cells",
					"unmerge_table_cells",
					"update_table_column_properties",
					"insert_page_break",
					"insert_section_break",
					"find_replace",
					"create_bullet_list",
					"create_named_range",
					"replace_named_range_content",
					"delete_named_range",
					"update_document_style",
					"update_section_style",
					"create_header_footer",
					"insert_image",
					"insert_doc_tab",
					"delete_doc_tab",
					"update_doc_tab",
				],
				not_supported: [
					"Office XML text extraction",
					"PDF text extraction",
					"markdown_to_docs full position-based conversion",
				],
			};
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(info, null, 2) },
				],
			};
		},
	);

	// ── 13. create_table_with_data ───────────────────────────────────────────
	server.tool(
		"create_table_with_data",
		"Create a table and populate it with data in one operation. CALL inspect_doc_structure FIRST to get the correct insertion index (use total_length).",
		{
			document_id: z.string(),
			table_data: z
				.array(z.array(z.string()))
				.describe(
					"2D array of strings: [[col1, col2], [row1c1, row1c2], ...]. All rows must have the same column count.",
				),
			index: z
				.number()
				.int()
				.describe(
					"Insertion position (from inspect_doc_structure 'total_length').",
				),
			bold_headers: z.boolean().default(true).describe("Bold the first row."),
			tab_id: z.string().optional().describe("Target tab ID."),
		},
		async ({ document_id, table_data, index, bold_headers, tab_id }) => {
			const { accessToken } = await ctx.getService("gdocs");
			if (table_data.length === 0 || table_data[0].length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "ERROR: table_data must be a non-empty 2D array.",
						},
					],
				};
			}
			const rows = table_data.length;
			const cols = table_data[0].length;
			for (const row of table_data) {
				if (row.length !== cols) {
					return {
						content: [
							{
								type: "text" as const,
								text: "ERROR: All rows in table_data must have the same number of columns.",
							},
						],
					};
				}
			}

			const effectiveIndex = index <= 1 ? 1 : index;

			// Step 1: Insert the table
			const insertReq = tab_id
				? {
						insertTable: {
							rows,
							columns: cols,
							location: buildLocation(effectiveIndex, tab_id),
						},
					}
				: {
						insertTable: {
							rows,
							columns: cols,
							location: { index: effectiveIndex },
						},
					};
			await batchUpdate(accessToken, document_id, [insertReq]);

			// Step 2: Re-fetch doc to find the table and get cell indices
			const docAfter = (await docsFetch(
				accessToken,
				buildUrl(`${DOCS_BASE}/documents/${encodeURIComponent(document_id)}`, {
					includeTabsContent: !!tab_id,
				}),
			)) as DocumentResponse;

			let content = docAfter.body?.content ?? [];
			if (tab_id) {
				function findTabContent(tabs: typeof docAfter.tabs): typeof content {
					for (const tab of tabs ?? []) {
						if (tab.tabProperties?.tabId === tab_id)
							return tab.documentTab?.body?.content ?? [];
						const found = findTabContent(tab.childTabs);
						if (found.length > 0) return found;
					}
					return [];
				}
				content = findTabContent(docAfter.tabs);
			}

			const tables = findTablesInContent(content);
			// Find the table at or nearest to our insertion point
			let targetTable: TableInfo | undefined;
			for (const t of tables) {
				if (t.startIndex >= effectiveIndex - 2) {
					targetTable = t;
					break;
				}
			}
			if (!targetTable) targetTable = tables[tables.length - 1];
			if (!targetTable) {
				return {
					content: [
						{
							type: "text" as const,
							text: "ERROR: Could not find newly inserted table in document.",
						},
					],
				};
			}

			// Step 3: Build insertText requests from last cell to first (reverse to avoid index shifts)
			const textRequests: unknown[] = [];
			for (let r = rows - 1; r >= 0; r--) {
				for (let c = cols - 1; c >= 0; c--) {
					const cellText = table_data[r]?.[c] ?? "";
					if (!cellText) continue;
					const cell = targetTable.cells[r]?.[c];
					if (!cell) continue;
					const insertIdx = cell.insertionIndex;
					const req: Record<string, unknown> = {
						insertText: {
							location: buildLocation(insertIdx, tab_id),
							text: cellText,
						},
					};
					textRequests.push(req);
				}
			}
			if (textRequests.length > 0) {
				await batchUpdate(accessToken, document_id, textRequests);
			}

			// Step 4: Bold first row if requested.
			// Re-fetch doc to get accurate cell indices after text insertion
			// (the stored insertionIndex values are stale once text has been added to cells).
			if (bold_headers && table_data[0]) {
				const docForBold = (await docsFetch(
					accessToken,
					buildUrl(
						`${DOCS_BASE}/documents/${encodeURIComponent(document_id)}`,
						{ includeTabsContent: !!tab_id },
					),
				)) as DocumentResponse;
				let boldContent = docForBold.body?.content ?? [];
				if (tab_id) {
					function findTabForBold(
						tabs: typeof docForBold.tabs,
					): typeof boldContent {
						for (const tab of tabs ?? []) {
							if (tab.tabProperties?.tabId === tab_id)
								return tab.documentTab?.body?.content ?? [];
							const found = findTabForBold(tab.childTabs);
							if (found.length > 0) return found;
						}
						return [];
					}
					boldContent = findTabForBold(docForBold.tabs);
				}
				const freshTables = findTablesInContent(boldContent);
				// Find the same table by its startIndex (unchanged after text insertion)
				const tableStartIdx = targetTable.startIndex;
				const freshTable =
					freshTables.find((t) => t.startIndex === tableStartIdx) ??
					freshTables[freshTables.length - 1];
				if (freshTable?.cells[0]) {
					const boldReqs: unknown[] = [];
					for (let ci = 0; ci < freshTable.cells[0].length; ci++) {
						const cell = freshTable.cells[0][ci];
						const text = table_data[0]?.[ci] ?? "";
						if (!text || !cell) continue;
						const startIdx = cell.insertionIndex;
						boldReqs.push({
							updateTextStyle: {
								range: buildRange(startIdx, startIdx + text.length, tab_id),
								textStyle: { bold: true },
								fields: "bold",
							},
						});
					}
					if (boldReqs.length > 0) {
						await batchUpdate(accessToken, document_id, boldReqs);
					}
				}
			}

			const link = DOCS_LINK(document_id);
			return {
				content: [
					{
						type: "text" as const,
						text: `SUCCESS: Created and populated ${rows}x${cols} table at index ${effectiveIndex} in document ${document_id}. Link: ${link}`,
					},
				],
			};
		},
	);

	// ── 14. debug_table_structure ────────────────────────────────────────────
	server.tool(
		"debug_table_structure",
		"Debug tool: inspect per-cell structure of a table in a Google Doc. Shows cell positions, insertion indices, and current content.",
		{
			document_id: z.string(),
			table_index: z
				.number()
				.int()
				.default(0)
				.describe("Which table to inspect (0 = first table)."),
		},
		async ({ document_id, table_index }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const doc = (await docsFetch(
				accessToken,
				`${DOCS_BASE}/documents/${encodeURIComponent(document_id)}`,
			)) as DocumentResponse;
			const tables = findTablesInContent(doc.body?.content ?? []);
			if (table_index >= tables.length) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: Table index ${table_index} not found. Document has ${tables.length} table(s).`,
						},
					],
				};
			}
			const table = tables[table_index];
			const debugInfo = {
				table_index,
				dimensions: `${table.rows}x${table.columns}`,
				table_range: `[${table.startIndex}-${table.endIndex}]`,
				cells: table.cells.map((row, ri) =>
					row.map((cell, ci) => ({
						position: `(${ri},${ci})`,
						range: `[${cell.startIndex}-${cell.endIndex}]`,
						insertion_index: cell.insertionIndex,
						current_content: JSON.stringify(cell.content),
					})),
				),
			};
			const link = DOCS_LINK(document_id);
			return {
				content: [
					{
						type: "text" as const,
						text: `Table structure debug for table ${table_index}:\n\n${JSON.stringify(debugInfo, null, 2)}\n\nLink: ${link}`,
					},
				],
			};
		},
	);

	// ── 15. export_doc_to_pdf ────────────────────────────────────────────────
	server.tool(
		"export_doc_to_pdf",
		"Export a Google Doc as a PDF and save it back to Google Drive. Returns the PDF file ID and link.",
		{
			document_id: z.string().describe("Google Doc ID to export."),
			pdf_filename: z
				.string()
				.optional()
				.describe("Name for the PDF file (default: '<docName>_PDF.pdf')."),
			folder_id: z
				.string()
				.optional()
				.describe(
					"Drive folder ID to save the PDF in (default: My Drive root).",
				),
		},
		async ({ document_id, pdf_filename, folder_id }) => {
			const { accessToken } = await ctx.getService("gdocs");

			// Verify it's a native Google Doc
			const fileMeta = (await driveFetch(
				accessToken,
				buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}`, {
					fields: "id,name,mimeType,webViewLink",
					supportsAllDrives: true,
				}),
			)) as {
				id?: string;
				name?: string;
				mimeType?: string;
				webViewLink?: string;
			};

			if (fileMeta.mimeType !== "application/vnd.google-apps.document") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: File '${fileMeta.name}' is not a Google Doc (MIME type: ${fileMeta.mimeType}). Only native Google Docs can be exported to PDF.`,
						},
					],
				};
			}

			// Export as PDF
			const exportUrl = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}/export`,
				{ mimeType: "application/pdf" },
			);
			const pdfResp = await fetch(exportUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (!pdfResp.ok) {
				throw new Error(
					`Failed to export document as PDF: ${pdfResp.status} ${await pdfResp.text()}`,
				);
			}
			const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());

			// Determine filename
			const originalName = fileMeta.name ?? "Document";
			const pdfName = pdf_filename
				? pdf_filename.endsWith(".pdf")
					? pdf_filename
					: `${pdf_filename}.pdf`
				: `${originalName}_PDF.pdf`;

			// Upload to Drive
			const uploaded = await uploadPdfToDrive(
				accessToken,
				pdfBytes,
				pdfName,
				folder_id,
			);
			const pdfId = uploaded.id ?? "N/A";
			const pdfLink = uploaded.webViewLink ?? "N/A";
			const originalLink = fileMeta.webViewLink ?? "#";

			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully exported '${originalName}' to PDF and saved to Drive as '${pdfName}' (ID: ${pdfId}, ${pdfBytes.byteLength.toLocaleString()} bytes)${folder_id ? ` in folder ${folder_id}` : ""}. PDF: ${pdfLink} | Original: ${originalLink}`,
					},
				],
			};
		},
	);

	// ── 16. update_paragraph_style ───────────────────────────────────────────
	server.tool(
		"update_paragraph_style",
		"Apply paragraph-level formatting to a range in a Google Doc: heading levels (H1-H6), alignment, spacing, indentation, and/or list formatting.",
		{
			document_id: z.string(),
			start_index: z.number().int(),
			end_index: z.number().int(),
			heading_level: z
				.number()
				.int()
				.min(0)
				.max(6)
				.optional()
				.describe(
					"0=normal text, 1–6=heading level. Mutually exclusive with named_style_type.",
				),
			alignment: z
				.string()
				.optional()
				.describe("START, CENTER, END, or JUSTIFIED."),
			line_spacing: z
				.number()
				.optional()
				.describe("Line spacing multiplier (1.0=single, 2.0=double)."),
			indent_first_line: z
				.number()
				.optional()
				.describe("First line indent in points."),
			indent_start: z.number().optional().describe("Left indent in points."),
			indent_end: z.number().optional().describe("Right indent in points."),
			space_above: z
				.number()
				.optional()
				.describe("Space above paragraph in points."),
			space_below: z
				.number()
				.optional()
				.describe("Space below paragraph in points."),
			named_style_type: z
				.string()
				.optional()
				.describe(
					"NORMAL_TEXT, TITLE, SUBTITLE, HEADING_1–6. Mutually exclusive with heading_level.",
				),
			tab_id: z.string().optional(),
			segment_id: z.string().optional(),
			direction: z
				.string()
				.optional()
				.describe("LEFT_TO_RIGHT or RIGHT_TO_LEFT."),
			keep_lines_together: z.boolean().optional(),
			keep_with_next: z.boolean().optional(),
			avoid_widow_and_orphan: z.boolean().optional(),
			page_break_before: z.boolean().optional(),
			spacing_mode: z
				.string()
				.optional()
				.describe("NEVER_COLLAPSE or COLLAPSE_LISTS."),
			shading_color: z
				.string()
				.optional()
				.describe("Paragraph background color (#RRGGBB)."),
			list_type: z
				.string()
				.optional()
				.describe("UNORDERED, ORDERED, CHECKBOX, or NONE (to remove bullets)."),
			list_nesting_level: z
				.number()
				.int()
				.min(0)
				.max(8)
				.optional()
				.describe("Nesting level 0–8."),
			bullet_preset: z
				.string()
				.optional()
				.describe("Explicit Docs bullet preset string."),
		},
		async ({
			document_id,
			start_index,
			end_index,
			heading_level,
			alignment,
			line_spacing,
			indent_first_line,
			indent_start,
			indent_end,
			space_above,
			space_below,
			named_style_type,
			tab_id,
			segment_id,
			direction,
			keep_lines_together,
			keep_with_next,
			avoid_widow_and_orphan,
			page_break_before,
			spacing_mode,
			shading_color,
			list_type,
			list_nesting_level,
			bullet_preset,
		}) => {
			const { accessToken } = await ctx.getService("gdocs");

			if (start_index < 0 || end_index <= start_index) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: end_index must be greater than start_index >= 0.",
						},
					],
				};
			}
			if (heading_level !== undefined && named_style_type !== undefined) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Error: heading_level and named_style_type are mutually exclusive.",
						},
					],
				};
			}

			const op = {
				heading_level,
				alignment,
				line_spacing,
				indent_first_line,
				indent_start,
				indent_end,
				space_above,
				space_below,
				named_style_type,
				direction,
				keep_lines_together,
				keep_with_next,
				avoid_widow_and_orphan,
				page_break_before,
				spacing_mode,
				shading_color,
			};
			const { paragraphStyle, fields } = buildParagraphStyleAndFields(op);
			const requests: unknown[] = [];

			if (fields) {
				requests.push({
					updateParagraphStyle: {
						range: buildRange(start_index, end_index, tab_id, segment_id),
						paragraphStyle,
						fields,
					},
				});
			}

			if (list_type) {
				const lt = list_type.toUpperCase();
				if (lt === "NONE") {
					requests.push({
						deleteParagraphBullets: {
							range: buildRange(start_index, end_index, tab_id, segment_id),
						},
					});
				} else {
					const preset =
						bullet_preset ??
						{
							UNORDERED: "BULLET_DISC_CIRCLE_SQUARE",
							ORDERED: "NUMBERED_DECIMAL_ALPHA_ROMAN",
							CHECKBOX: "BULLET_CHECKBOX",
						}[lt] ??
						"BULLET_DISC_CIRCLE_SQUARE";
					requests.push({
						createParagraphBullets: {
							range: buildRange(start_index, end_index, tab_id, segment_id),
							bulletPreset: preset,
						},
					});
				}
			}

			if (requests.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No paragraph style changes specified.",
						},
					],
				};
			}

			await batchUpdate(accessToken, document_id, requests);

			const summaryParts: string[] = [];
			if (named_style_type) summaryParts.push(named_style_type);
			else if (heading_level !== undefined)
				summaryParts.push(
					heading_level === 0 ? "NORMAL_TEXT" : `HEADING_${heading_level}`,
				);
			if (alignment) summaryParts.push(`alignment=${alignment}`);
			if (list_type) {
				let ld = `${list_type.toLowerCase()} list`;
				if (list_nesting_level) ld += ` (level ${list_nesting_level})`;
				summaryParts.push(ld);
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Applied paragraph formatting (${summaryParts.join(", ") || "style"}) to range ${start_index}-${end_index} in document ${document_id}. Link: ${DOCS_LINK(document_id)}`,
					},
				],
			};
		},
	);

	// ── 17. get_doc_as_markdown ──────────────────────────────────────────────
	server.tool(
		"get_doc_as_markdown",
		"Convert a Google Doc to Markdown (best-effort). Preserves headings, bold/italic, links, tables, and lists. Optionally includes Drive comments as an appendix.",
		{
			document_id: z.string().describe("Google Doc ID or URL."),
			include_comments: z
				.boolean()
				.default(true)
				.describe("Append Drive comments to the output."),
			comment_mode: z
				.string()
				.default("inline")
				.describe(
					"'inline' (footnote-style) or 'appendix' (grouped at end) or 'none'.",
				),
			include_resolved: z
				.boolean()
				.default(false)
				.describe("Include resolved comments."),
			suggestions_view_mode: z
				.enum([
					"DEFAULT_FOR_CURRENT_ACCESS",
					"SUGGESTIONS_INLINE",
					"PREVIEW_SUGGESTIONS_ACCEPTED",
					"PREVIEW_WITHOUT_SUGGESTIONS",
				])
				.default("DEFAULT_FOR_CURRENT_ACCESS"),
		},
		async ({
			document_id,
			include_comments,
			comment_mode,
			include_resolved,
			suggestions_view_mode,
		}) => {
			const { accessToken } = await ctx.getService("gdocs");

			// Extract doc ID from URL if needed
			const urlMatch = /\/d\/([\w-]+)/.exec(document_id);
			const docId = urlMatch ? urlMatch[1] : document_id;

			if (!["inline", "appendix", "none"].includes(comment_mode)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: comment_mode must be 'inline', 'appendix', or 'none'. Got '${comment_mode}'.`,
						},
					],
				};
			}

			const doc = (await docsFetch(
				accessToken,
				buildUrl(`${DOCS_BASE}/documents/${encodeURIComponent(docId)}`, {
					includeTabsContent: true,
					suggestionsViewMode: suggestions_view_mode,
				}),
			)) as DocumentResponse;

			let markdown = docToMarkdown(doc);

			if (!include_comments || comment_mode === "none") {
				return { content: [{ type: "text" as const, text: markdown }] };
			}

			// Fetch comments from Drive
			const allComments: Array<Record<string, unknown>> = [];
			let pageToken: string | undefined;
			do {
				const commentsData = (await driveFetch(
					accessToken,
					buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(docId)}/comments`,
						{
							fields:
								"comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(id,content,author,createdTime,modifiedTime)),nextPageToken",
							includeDeleted: false,
							pageToken: pageToken,
						},
					),
				)) as {
					comments?: Array<Record<string, unknown>>;
					nextPageToken?: string;
				};
				allComments.push(...(commentsData.comments ?? []));
				pageToken = commentsData.nextPageToken;
			} while (pageToken);

			const visibleComments = include_resolved
				? allComments
				: allComments.filter((c) => !c.resolved);

			if (visibleComments.length === 0) {
				return { content: [{ type: "text" as const, text: markdown }] };
			}

			// Build comment appendix
			const commentLines: string[] = ["", "---", "## Comments", ""];
			for (const comment of visibleComments) {
				const author =
					(comment.author as Record<string, unknown> | undefined)
						?.displayName ?? "Unknown";
				const content = String(comment.content ?? "");
				const created = String(comment.createdTime ?? "");
				const resolved = comment.resolved ? " [resolved]" : "";
				const quotedText = (
					comment.quotedFileContent as Record<string, unknown> | undefined
				)?.value;
				commentLines.push(`**${author}** (${created})${resolved}:`);
				if (quotedText)
					commentLines.push(`> ${String(quotedText).replace(/\n/g, "\n> ")}`);
				commentLines.push(content);
				const replies = comment.replies as
					| Array<Record<string, unknown>>
					| undefined;
				for (const reply of replies ?? []) {
					const rAuthor =
						(reply.author as Record<string, unknown> | undefined)
							?.displayName ?? "Unknown";
					const rContent = String(reply.content ?? "");
					commentLines.push(`  - **${rAuthor}**: ${rContent}`);
				}
				commentLines.push("");
			}

			if (comment_mode === "appendix") {
				markdown = `${markdown.trimEnd()}\n${commentLines.join("\n")}`;
			} else {
				// inline mode — full per-character anchor matching is not available;
				// comments are appended as an appendix section (best-effort degradation).
				commentLines.unshift(
					"",
					"<!-- NOTE: comment_mode=inline requested but true inline anchoring is not supported in this runtime; comments are shown as an appendix instead. -->",
				);
				markdown = `${markdown.trimEnd()}\n${commentLines.join("\n")}`;
			}
			return { content: [{ type: "text" as const, text: markdown }] };
		},
	);

	// ── 18. manage_doc_tab ───────────────────────────────────────────────────
	server.tool(
		"manage_doc_tab",
		"Create, rename, delete, or populate a tab in a Google Doc. Note: populate_from_markdown is not supported in this runtime (complex position-based request generation required).",
		{
			document_id: z.string(),
			action: z
				.enum(["create", "rename", "delete", "populate_from_markdown"])
				.describe("Action to perform."),
			tab_id: z
				.string()
				.optional()
				.describe(
					"Tab ID (required for rename, delete, populate_from_markdown).",
				),
			title: z
				.string()
				.optional()
				.describe("Tab title (required for create; used by rename)."),
			index: z
				.number()
				.int()
				.optional()
				.describe("0-based position index for new tab (required for create)."),
			parent_tab_id: z
				.string()
				.optional()
				.describe("Parent tab ID to nest under (create only)."),
			markdown_text: z
				.string()
				.optional()
				.describe(
					"Markdown to render (populate_from_markdown only — not supported in this runtime).",
				),
			replace_existing: z
				.boolean()
				.default(true)
				.describe(
					"Clear tab body before inserting (populate_from_markdown only).",
				),
		},
		async ({ document_id, action, tab_id, title, index, parent_tab_id }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const link = DOCS_LINK(document_id);

			if (action === "populate_from_markdown") {
				return {
					content: [
						{
							type: "text" as const,
							text: "Not supported in this runtime: populate_from_markdown requires a complex position-based Markdown-to-Docs request generator (markdown_to_docs_requests) that is not available in Cloudflare Workers. Use batch_update_doc with insert_text operations to add content, then format with update_paragraph_style.",
						},
					],
				};
			}

			if (action === "create") {
				if (!title)
					throw new Error("'title' is required for the 'create' action.");
				if (index === undefined)
					throw new Error("'index' is required for the 'create' action.");
				const tabProperties: Record<string, unknown> = { title, index };
				if (parent_tab_id) tabProperties.parentTabId = parent_tab_id;
				const result = await batchUpdate(accessToken, document_id, [
					{ addDocumentTab: { tabProperties } },
				]);
				const replies = result.replies as
					| Array<Record<string, unknown>>
					| undefined;
				const reply = replies?.[0];
				let newTabId: string | undefined;
				for (const key of ["addDocumentTab", "createDocumentTab"] as const) {
					const replyData = reply?.[key] as Record<string, unknown> | undefined;
					if (replyData) {
						newTabId = (
							replyData.tabProperties as Record<string, unknown> | undefined
						)?.tabId as string | undefined;
						break;
					}
				}
				let msg = `Inserted tab '${title}' at index ${index} in document ${document_id}.`;
				if (newTabId) msg += ` Tab ID: ${newTabId}.`;
				if (parent_tab_id) msg += ` Nested under parent tab ${parent_tab_id}.`;
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								action,
								success: true,
								message: msg,
								tab_id: newTabId,
								requests_applied: 1,
								link,
							}),
						},
					],
				};
			}

			if (action === "delete") {
				if (!tab_id)
					throw new Error("'tab_id' is required for the 'delete' action.");
				await batchUpdate(accessToken, document_id, [
					{ deleteTab: { tabId: tab_id } },
				]);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								action,
								success: true,
								message: `Deleted tab '${tab_id}' from document ${document_id}.`,
								tab_id,
								requests_applied: 1,
								link,
							}),
						},
					],
				};
			}

			// rename
			if (!tab_id)
				throw new Error("'tab_id' is required for the 'rename' action.");
			if (!title)
				throw new Error("'title' is required for the 'rename' action.");
			await batchUpdate(accessToken, document_id, [
				{
					updateDocumentTabProperties: {
						tabProperties: { tabId: tab_id, title },
						fields: "title",
					},
				},
			]);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							action,
							success: true,
							message: `Renamed tab '${tab_id}' to '${title}' in document ${document_id}.`,
							tab_id,
							requests_applied: 1,
							link,
						}),
					},
				],
			};
		},
	);

	// ── 19. list_document_comments ───────────────────────────────────────────
	server.tool(
		"list_document_comments",
		"List comments on a Google Doc via the Drive API.",
		{
			document_id: z.string().describe("Google Doc ID."),
			max_comments: z
				.number()
				.int()
				.optional()
				.describe("Maximum total comments to return."),
		},
		async ({ document_id, max_comments }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const allComments: Array<Record<string, unknown>> = [];
			let pageToken: string | undefined;
			do {
				const data = (await driveFetch(
					accessToken,
					buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(document_id)}/comments`,
						{
							fields:
								"comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(id,content,author,createdTime,modifiedTime)),nextPageToken",
							includeDeleted: false,
							pageSize: 100,
							pageToken: pageToken,
						},
					),
				)) as {
					comments?: Array<Record<string, unknown>>;
					nextPageToken?: string;
				};
				allComments.push(...(data.comments ?? []));
				pageToken = data.nextPageToken;
			} while (
				pageToken &&
				(!max_comments || allComments.length < max_comments)
			);

			const comments = max_comments
				? allComments.slice(0, max_comments)
				: allComments;
			if (comments.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No comments found on document ${document_id}.`,
						},
					],
				};
			}
			const lines = [
				`Found ${comments.length} comment(s) on document ${document_id}:`,
			];
			for (const c of comments) {
				const author =
					(c.author as Record<string, unknown> | undefined)?.displayName ??
					"Unknown";
				const content = String(c.content ?? "");
				const created = String(c.createdTime ?? "");
				const resolved = c.resolved ? " [resolved]" : "";
				const quoted = (
					c.quotedFileContent as Record<string, unknown> | undefined
				)?.value;
				lines.push(`\n[${c.id}] ${author} (${created})${resolved}:`);
				if (quoted) lines.push(`  Anchor: "${String(quoted).slice(0, 100)}"`);
				lines.push(`  ${content}`);
				const replies = c.replies as Array<Record<string, unknown>> | undefined;
				for (const r of replies ?? []) {
					const rAuthor =
						(r.author as Record<string, unknown> | undefined)?.displayName ??
						"Unknown";
					lines.push(`  Reply from ${rAuthor}: ${String(r.content ?? "")}`);
				}
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 20. manage_document_comment ──────────────────────────────────────────
	server.tool(
		"manage_document_comment",
		"Create a comment, reply to an existing comment, or resolve a comment on a Google Doc.",
		{
			document_id: z.string().describe("Google Doc ID."),
			action: z
				.enum(["create", "reply", "resolve"])
				.describe("'create', 'reply', or 'resolve'."),
			comment_content: z
				.string()
				.optional()
				.describe("Comment or reply text (required for create and reply)."),
			comment_id: z
				.string()
				.optional()
				.describe("Comment ID (required for reply and resolve)."),
		},
		async ({ document_id, action, comment_content, comment_id }) => {
			const { accessToken } = await ctx.getService("gdocs");
			const commentsBase = `${DRIVE_BASE}/files/${encodeURIComponent(document_id)}/comments`;

			const COMMENT_FIELDS = "id,content,author,createdTime,modifiedTime";

			if (action === "create") {
				if (!comment_content)
					throw new Error("'comment_content' is required to create a comment.");
				const result = (await driveFetch(
					accessToken,
					buildUrl(commentsBase, { fields: COMMENT_FIELDS }),
					{
						method: "POST",
						body: JSON.stringify({ content: comment_content }),
					},
				)) as {
					id?: string;
					author?: { displayName?: string };
					createdTime?: string;
				};
				return {
					content: [
						{
							type: "text" as const,
							text: `Comment created successfully!\nComment ID: ${result.id ?? "N/A"}\nAuthor: ${result.author?.displayName ?? "Unknown"}\nCreated: ${result.createdTime ?? ""}\nContent: ${comment_content}`,
						},
					],
				};
			}

			if (action === "reply") {
				if (!comment_id)
					throw new Error("'comment_id' is required to reply to a comment.");
				if (!comment_content)
					throw new Error("'comment_content' is required for a reply.");
				const result = (await driveFetch(
					accessToken,
					buildUrl(
						`${commentsBase}/${encodeURIComponent(comment_id)}/replies`,
						{ fields: COMMENT_FIELDS },
					),
					{
						method: "POST",
						body: JSON.stringify({ content: comment_content }),
					},
				)) as {
					id?: string;
					author?: { displayName?: string };
					createdTime?: string;
				};
				return {
					content: [
						{
							type: "text" as const,
							text: `Reply posted successfully!\nReply ID: ${result.id ?? "N/A"}\nAuthor: ${result.author?.displayName ?? "Unknown"}\nCreated: ${result.createdTime ?? ""}\nContent: ${comment_content}`,
						},
					],
				};
			}

			// resolve — Drive v3: `resolved` is output-only; resolve via replies.create with action:"resolve"
			if (!comment_id)
				throw new Error("'comment_id' is required to resolve a comment.");
			const resolveResult = (await driveFetch(
				accessToken,
				buildUrl(`${commentsBase}/${encodeURIComponent(comment_id)}/replies`, {
					fields: COMMENT_FIELDS,
				}),
				{
					method: "POST",
					body: JSON.stringify({
						content: "This comment has been resolved.",
						action: "resolve",
					}),
				},
			)) as {
				id?: string;
				author?: { displayName?: string };
				createdTime?: string;
			};
			return {
				content: [
					{
						type: "text" as const,
						text: `Comment ${comment_id} has been resolved successfully.\nResolve reply ID: ${resolveResult.id ?? "N/A"}\nAuthor: ${resolveResult.author?.displayName ?? "Unknown"}\nCreated: ${resolveResult.createdTime ?? ""}`,
					},
				],
			};
		},
	);
}
