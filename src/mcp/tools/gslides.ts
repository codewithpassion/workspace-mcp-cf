// Google Slides tools — 7 tools for the `gslides` service.
//
// Module pattern (same for all service modules):
//   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//   import { z } from "zod";
//   import { googleApiFetch, type ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// Tools 1–5 use the gslides service (presentations + presentations.readonly scopes).
// Tools 6–7 (comment tools) use the gdrive service (Drive API for comments).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URLs ─────────────────────────────────────────────────────────────

const SLIDES_BASE = "https://slides.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

// ─── Authenticated fetch alias ─────────────────────────────────────────────────

const slidesFetch = googleApiFetch;

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

// ─── Response types ────────────────────────────────────────────────────────────

interface TextElement {
	startIndex?: number;
	textRun?: { content?: string };
}

interface Shape {
	shapeType?: string;
	text?: { textElements?: TextElement[] };
}

interface TableDimension {
	rows?: number;
	columns?: number;
}

interface PageElement {
	objectId?: string;
	shape?: Shape;
	table?: TableDimension;
	line?: { lineType?: string };
	elementGroup?: { children?: PageElement[] };
}

interface Slide {
	objectId?: string;
	pageElements?: PageElement[];
	slideProperties?: {
		notesPage?: { objectId?: string };
	};
}

interface PageSize {
	width?: { magnitude?: number; unit?: string };
	height?: { magnitude?: number; unit?: string };
}

interface PresentationResponse {
	presentationId?: string;
	title?: string;
	slides?: Slide[];
	pageSize?: PageSize;
	masters?: Array<{ objectId?: string }>;
	layouts?: Array<{ objectId?: string }>;
	notesMaster?: { objectId?: string };
}

interface PageResponse {
	pageType?: string;
	pageElements?: PageElement[];
}

interface ThumbnailResponse {
	contentUrl?: string;
}

interface BatchUpdateResponse {
	replies?: Array<Record<string, unknown>>;
}

interface CommentAuthor {
	displayName?: string;
}

interface CommentReply {
	id?: string;
	content?: string;
	author?: CommentAuthor;
	createdTime?: string;
}

interface DriveComment {
	id?: string;
	content?: string;
	author?: CommentAuthor;
	createdTime?: string;
	resolved?: boolean;
	quotedFileContent?: { value?: string };
	replies?: CommentReply[];
}

interface CommentsListResponse {
	comments?: DriveComment[];
	nextPageToken?: string;
}

// ─── Shape text extraction ─────────────────────────────────────────────────────

/**
 * Extract the full text content from a Slides shape, sorted by text-run start index.
 * Returns an empty string if the shape has no text.
 */
function extractShapeText(shape: Shape | undefined): string {
	if (!shape) return "";
	const text = shape.text;
	if (!text) return "";
	const runs: Array<[number, string]> = [];
	for (const elem of text.textElements ?? []) {
		const textRun = elem.textRun;
		if (textRun?.content) {
			runs.push([elem.startIndex ?? 0, textRun.content]);
		}
	}
	if (runs.length === 0) return "";
	runs.sort((a, b) => a[0] - b[0]);
	return runs.map(([, content]) => content).join("");
}

/**
 * Recursively collect text strings from shapes and elementGroup children.
 * Groups are descended so text inside grouped shapes is not skipped.
 */
function iterTextBearingElements(elements: PageElement[]): string[] {
	const texts: string[] = [];
	for (const elem of elements) {
		if (elem.shape) {
			const fullText = extractShapeText(elem.shape);
			if (fullText) texts.push(fullText);
		} else if (elem.elementGroup?.children) {
			texts.push(...iterTextBearingElements(elem.elementGroup.children));
		}
	}
	return texts;
}

/**
 * Build descriptive lines for page elements, recursing into elementGroups
 * so grouped shapes and their text content are visible.
 */
function describeElements(elements: PageElement[], indent = "  "): string[] {
	const info: string[] = [];
	for (const elem of elements) {
		const elemId = elem.objectId ?? "Unknown";
		if (elem.shape) {
			const shapeType = elem.shape.shapeType ?? "Unknown";
			const fullText = extractShapeText(elem.shape);
			if (fullText) {
				const lines = fullText
					.split("\n")
					.map((l) => l.trimEnd())
					.filter((l) => l.trim().length > 0);
				if (lines.length === 1) {
					info.push(
						`${indent}Shape: ID ${elemId}, Type: ${shapeType}, Text: "${lines[0]}"`,
					);
				} else {
					info.push(`${indent}Shape: ID ${elemId}, Type: ${shapeType}, Text:`);
					for (const line of lines) info.push(`${indent}  > ${line}`);
				}
			} else {
				info.push(`${indent}Shape: ID ${elemId}, Type: ${shapeType}`);
			}
		} else if (elem.table) {
			const rows = elem.table.rows ?? 0;
			const cols = elem.table.columns ?? 0;
			info.push(`${indent}Table: ID ${elemId}, Size: ${rows}x${cols}`);
		} else if (elem.line) {
			const lineType = elem.line.lineType ?? "Unknown";
			info.push(`${indent}Line: ID ${elemId}, Type: ${lineType}`);
		} else if (elem.elementGroup) {
			const children = elem.elementGroup.children ?? [];
			info.push(`${indent}Group: ID ${elemId}, Children: ${children.length}`);
			info.push(...describeElements(children, `${indent}  `));
		} else {
			info.push(`${indent}Element: ID ${elemId}, Type: Unknown`);
		}
	}
	return info;
}

// ─── Batch update validation ───────────────────────────────────────────────────

const SLIDES_BATCH_REQUEST_TYPES = new Set([
	"createSlide",
	"createShape",
	"createTable",
	"insertText",
	"insertTableRows",
	"insertTableColumns",
	"deleteTableRow",
	"deleteTableColumn",
	"replaceAllText",
	"deleteObject",
	"updatePageElementTransform",
	"updateSlidesPosition",
	"deleteText",
	"createImage",
	"createVideo",
	"createSheetsChart",
	"createLine",
	"refreshSheetsChart",
	"updateShapeProperties",
	"updateImageProperties",
	"updateVideoProperties",
	"updatePageProperties",
	"updateTableCellProperties",
	"updateLineProperties",
	"createParagraphBullets",
	"replaceAllShapesWithImage",
	"duplicateObject",
	"updateTextStyle",
	"replaceAllShapesWithSheetsChart",
	"deleteParagraphBullets",
	"updateParagraphStyle",
	"updateTableBorderProperties",
	"updateTableColumnProperties",
	"updateTableRowProperties",
	"mergeTableCells",
	"unmergeTableCells",
	"groupObjects",
	"ungroupObjects",
	"updatePageElementAltText",
	"replaceImage",
	"updateSlideProperties",
	"updatePageElementsZOrder",
	"updateLineCategory",
	"rerouteLine",
]);

const SLIDES_REQUEST_EXAMPLES =
	"createSlide, createShape, insertText, updateTextStyle, createImage, deleteObject";

/**
 * Validates that each request object contains exactly one known Slides request type.
 * Mirrors Python's validate_batch_update_requests() in gslides/slides_helpers.py.
 */
function validateBatchUpdateRequests(
	requests: Array<Record<string, unknown>>,
): void {
	if (requests.length === 0) {
		throw new Error(
			`Invalid Slides batch update request: requests must contain at least one ` +
				`request object with exactly one Slides request type such as ${SLIDES_REQUEST_EXAMPLES}.`,
		);
	}
	for (let i = 0; i < requests.length; i++) {
		const req = requests[i];
		const reqTypes = Object.keys(req);
		if (reqTypes.length !== 1) {
			const problem =
				reqTypes.length === 0
					? "is empty"
					: `contains multiple fields (${reqTypes.join(", ")})`;
			throw new Error(
				`Invalid Slides batch update request: requests[${i}] ${problem}; ` +
					`it must contain exactly one Slides request type such as ${SLIDES_REQUEST_EXAMPLES}.`,
			);
		}
		const reqType = reqTypes[0];
		if (!SLIDES_BATCH_REQUEST_TYPES.has(reqType)) {
			throw new Error(
				`Invalid Slides batch update request: requests[${i}] has unsupported ` +
					`request type '${reqType}'. It must contain exactly one Slides request ` +
					`type such as ${SLIDES_REQUEST_EXAMPLES}.`,
			);
		}
		if (typeof req[reqType] !== "object" || req[reqType] === null) {
			throw new Error(
				`Invalid Slides batch update request: requests[${i}].${reqType} must be ` +
					`an object for exactly one Slides request type such as ${SLIDES_REQUEST_EXAMPLES}.`,
			);
		}
	}
}

/**
 * Validates that insertText objectIds target text-capable shapes, not slide/page IDs.
 * Fetches the presentation's page IDs and cross-references against insertText targets.
 * Mirrors Python's validate_insert_text_targets() in gslides/slides_helpers.py.
 */
async function validateInsertTextTargets(
	accessToken: string,
	presentationId: string,
	requests: Array<Record<string, unknown>>,
): Promise<void> {
	// Collect all insertText objectId targets
	const insertTextTargets: Array<[number, string]> = [];
	for (let i = 0; i < requests.length; i++) {
		const payload = requests[i].insertText;
		if (
			payload !== null &&
			typeof payload === "object" &&
			!Array.isArray(payload)
		) {
			const objectId = (payload as Record<string, unknown>).objectId;
			if (typeof objectId === "string" && objectId) {
				insertTextTargets.push([i, objectId]);
			}
		}
	}
	if (insertTextTargets.length === 0) return;

	// Collect slide IDs from createSlide requests in the same batch
	const pageIds = new Set<string>();
	for (const req of requests) {
		const payload = req.createSlide;
		if (
			payload !== null &&
			typeof payload === "object" &&
			!Array.isArray(payload)
		) {
			const objectId = (payload as Record<string, unknown>).objectId;
			if (typeof objectId === "string" && objectId) {
				pageIds.add(objectId);
			}
		}
	}

	// Fetch existing slide/page/master/layout IDs from the presentation
	const fields =
		"slides(objectId,slideProperties(notesPage(objectId))),masters(objectId),layouts(objectId),notesMaster(objectId)";
	const url = buildUrl(
		`${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}`,
		{ fields },
	);
	const pres = (await slidesFetch(accessToken, url)) as PresentationResponse;

	for (const slide of pres.slides ?? []) {
		if (slide.objectId) pageIds.add(slide.objectId);
		const notesId = slide.slideProperties?.notesPage?.objectId;
		if (notesId) pageIds.add(notesId);
	}
	for (const master of pres.masters ?? []) {
		if (master.objectId) pageIds.add(master.objectId);
	}
	for (const layout of pres.layouts ?? []) {
		if (layout.objectId) pageIds.add(layout.objectId);
	}
	if (pres.notesMaster?.objectId) pageIds.add(pres.notesMaster.objectId);

	const invalidTargets = insertTextTargets.filter(([, id]) => pageIds.has(id));
	if (invalidTargets.length === 0) return;

	const invalidRefs = invalidTargets
		.map(([i, id]) => `requests[${i}].insertText.objectId='${id}'`)
		.join(", ");
	throw new Error(
		`Invalid Slides batch update request: ${invalidRefs} targets a slide/page object. ` +
			"The Slides API only allows insertText on text-capable shapes or table cells. " +
			"Create a text box or shape first with createShape, set elementProperties.pageObjectId " +
			"to the slide ID, then insertText into the new shape objectId. For existing content, " +
			"call get_page and use a Shape or Table element ID, not the Page ID.",
	);
}

// ─── Comment implementation helpers ───────────────────────────────────────────

/**
 * List all comments on a Drive file (presentation), paginating up to maxComments.
 * Uses the Drive v3 API — mirrors Python's _read_comments_impl in core/comments.py.
 */
async function listCommentsImpl(
	accessToken: string,
	fileId: string,
	maxComments: number,
): Promise<string> {
	const fields =
		"nextPageToken,comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(content,author,id,createdTime,modifiedTime))";

	const comments: DriveComment[] = [];
	let pageToken: string | undefined;

	while (comments.length < maxComments) {
		const pageSize = Math.min(100, maxComments - comments.length);
		const url = buildUrl(
			`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments`,
			{ fields, pageSize, pageToken },
		);
		const resp = (await slidesFetch(accessToken, url)) as CommentsListResponse;
		const pageComments = resp.comments ?? [];
		const take = Math.min(pageComments.length, maxComments - comments.length);
		comments.push(...pageComments.slice(0, take));
		pageToken = resp.nextPageToken;
		if (!pageToken || comments.length >= maxComments) break;
	}

	if (comments.length === 0) {
		return `No comments found in presentation ${fileId}`;
	}

	const output: string[] = [
		`Found ${comments.length} comments in presentation ${fileId}:\n`,
	];
	for (const comment of comments) {
		const author = comment.author?.displayName ?? "Unknown";
		const content = comment.content ?? "";
		const created = comment.createdTime ?? "";
		const resolved = comment.resolved ?? false;
		const commentId = comment.id ?? "";
		const status = resolved ? " [RESOLVED]" : "";
		const quotedText = comment.quotedFileContent?.value ?? "";

		output.push(`Comment ID: ${commentId}`);
		output.push(`Author: ${author}`);
		output.push(`Created: ${created}${status}`);
		if (quotedText) output.push(`Quoted text: ${quotedText}`);
		output.push(`Content: ${content}`);

		const replies = comment.replies ?? [];
		if (replies.length > 0) {
			output.push(`  Replies (${replies.length}):`);
			for (const reply of replies) {
				output.push(`    Reply ID: ${reply.id ?? ""}`);
				output.push(`    Author: ${reply.author?.displayName ?? "Unknown"}`);
				output.push(`    Created: ${reply.createdTime ?? ""}`);
				output.push(`    Content: ${reply.content ?? ""}`);
			}
		}
		output.push("");
	}

	return output.join("\n");
}

/**
 * Create a comment on a Drive file. Mirrors Python's _create_comment_impl.
 */
async function createCommentImpl(
	accessToken: string,
	fileId: string,
	commentContent: string,
): Promise<string> {
	const url = buildUrl(
		`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments`,
		{ fields: "id,content,author,createdTime" },
	);
	const comment = (await slidesFetch(accessToken, url, {
		method: "POST",
		body: JSON.stringify({ content: commentContent }),
	})) as DriveComment;

	return [
		"Comment created successfully!",
		`Comment ID: ${comment.id ?? ""}`,
		`Author: ${comment.author?.displayName ?? "Unknown"}`,
		`Created: ${comment.createdTime ?? ""}`,
		`Content: ${commentContent}`,
	].join("\n");
}

/**
 * Reply to a comment on a Drive file. Mirrors Python's _reply_to_comment_impl.
 */
async function replyToCommentImpl(
	accessToken: string,
	fileId: string,
	commentId: string,
	replyContent: string,
): Promise<string> {
	const url = buildUrl(
		`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}/replies`,
		{ fields: "id,content,author,createdTime" },
	);
	const reply = (await slidesFetch(accessToken, url, {
		method: "POST",
		body: JSON.stringify({ content: replyContent }),
	})) as CommentReply;

	return [
		"Reply posted successfully!",
		`Reply ID: ${reply.id ?? ""}`,
		`Author: ${reply.author?.displayName ?? "Unknown"}`,
		`Created: ${reply.createdTime ?? ""}`,
		`Content: ${replyContent}`,
	].join("\n");
}

/**
 * Resolve a comment by posting a resolve reply. Mirrors Python's _resolve_comment_impl.
 */
async function resolveCommentImpl(
	accessToken: string,
	fileId: string,
	commentId: string,
): Promise<string> {
	const url = buildUrl(
		`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}/replies`,
		{ fields: "id,content,author,createdTime" },
	);
	const reply = (await slidesFetch(accessToken, url, {
		method: "POST",
		body: JSON.stringify({
			content: "This comment has been resolved.",
			action: "resolve",
		}),
	})) as CommentReply;

	return [
		`Comment ${commentId} has been resolved successfully.`,
		`Resolve reply ID: ${reply.id ?? ""}`,
		`Author: ${reply.author?.displayName ?? "Unknown"}`,
		`Created: ${reply.createdTime ?? ""}`,
	].join("\n");
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. create_presentation ─────────────────────────────────────────────────
	server.tool(
		"create_presentation",
		"Create a new Google Slides presentation.",
		{
			title: z
				.string()
				.default("Untitled Presentation")
				.describe(
					'Title for the new presentation. Defaults to "Untitled Presentation".',
				),
		},
		async ({ title }) => {
			const { accessToken } = await ctx.getService("gslides");
			const result = (await slidesFetch(
				accessToken,
				`${SLIDES_BASE}/presentations`,
				{
					method: "POST",
					body: JSON.stringify({ title }),
				},
			)) as PresentationResponse;

			const presId = result.presentationId ?? "";
			const presUrl = `https://docs.google.com/presentation/d/${presId}/edit`;
			const slideCount = (result.slides ?? []).length;

			const text = [
				"Presentation Created Successfully:",
				`- Title: ${title}`,
				`- Presentation ID: ${presId}`,
				`- URL: ${presUrl}`,
				`- Slides: ${slideCount} slide(s) created`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 2. get_presentation ────────────────────────────────────────────────────
	server.tool(
		"get_presentation",
		"Get details about a Google Slides presentation including title, slide count, and per-slide text content.",
		{
			presentation_id: z
				.string()
				.describe("ID of the presentation to retrieve."),
		},
		async ({ presentation_id }) => {
			const { accessToken } = await ctx.getService("gslides");
			const result = (await slidesFetch(
				accessToken,
				`${SLIDES_BASE}/presentations/${encodeURIComponent(presentation_id)}`,
			)) as PresentationResponse;

			const title = result.title ?? "Untitled";
			const slides = result.slides ?? [];
			const pageSize = result.pageSize;

			const slidesInfo: string[] = [];
			for (let i = 0; i < slides.length; i++) {
				const slide = slides[i];
				const slideId = slide.objectId ?? "Unknown";
				const pageElements = slide.pageElements ?? [];

				let slideText = "";
				try {
					const texts = iterTextBearingElements(pageElements);
					const rawText = texts.join("\n");
					const rows = rawText.split("\n").filter((r) => r.trim().length > 0);
					if (rows.length > 0) {
						slideText = `\n${rows.map((r) => `    > ${r}`).join("\n")}`;
					}
				} catch (e) {
					slideText = `<failed to extract text: ${e}>`;
				}

				slidesInfo.push(
					`  Slide ${i + 1}: ID ${slideId}, ${pageElements.length} element(s), text: ${slideText || "empty"}`,
				);
			}

			const width = pageSize?.width?.magnitude ?? "Unknown";
			const height = pageSize?.height?.magnitude ?? "Unknown";
			const unit = pageSize?.width?.unit ?? "";

			const text = [
				"Presentation Details:",
				`- Title: ${title}`,
				`- Presentation ID: ${presentation_id}`,
				`- URL: https://docs.google.com/presentation/d/${presentation_id}/edit`,
				`- Total Slides: ${slides.length}`,
				`- Page Size: ${width} x ${height} ${unit}`,
				"",
				"Slides Breakdown:",
				slidesInfo.length > 0 ? slidesInfo.join("\n") : "  No slides found",
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 3. batch_update_presentation ──────────────────────────────────────────
	server.tool(
		"batch_update_presentation",
		[
			"Apply batch updates to a Google Slides presentation.",
			"Each request object must contain exactly one supported Slides request type",
			"(createSlide, createShape, insertText, updateTextStyle, createImage, deleteObject, etc.).",
			"insertText.objectId must be a text-capable shape or table object ID, NOT a slide/page ID.",
			"To add text to a slide: first createShape with elementProperties.pageObjectId set to the slide ID,",
			"then insertText into the resulting shape objectId.",
			"To edit existing text: call get_page and use a Shape or Table element ID.",
		].join(" "),
		{
			presentation_id: z.string().describe("ID of the presentation to update."),
			requests: z
				.array(z.record(z.string(), z.unknown()))
				.describe(
					"List of Slides API update request objects. Each must have exactly one request type key.",
				),
		},
		async ({ presentation_id, requests }) => {
			const { accessToken } = await ctx.getService("gslides");

			validateBatchUpdateRequests(requests);
			await validateInsertTextTargets(accessToken, presentation_id, requests);

			const result = (await slidesFetch(
				accessToken,
				`${SLIDES_BASE}/presentations/${encodeURIComponent(presentation_id)}:batchUpdate`,
				{
					method: "POST",
					body: JSON.stringify({ requests }),
				},
			)) as BatchUpdateResponse;

			const replies = result.replies ?? [];
			const lines = [
				"Batch Update Completed:",
				`- Presentation ID: ${presentation_id}`,
				`- URL: https://docs.google.com/presentation/d/${presentation_id}/edit`,
				`- Requests Applied: ${requests.length}`,
				`- Replies Received: ${replies.length}`,
			];

			if (replies.length > 0) {
				lines.push("", "Update Results:");
				for (let i = 0; i < replies.length; i++) {
					const reply = replies[i];
					if (
						reply.createSlide !== undefined &&
						typeof reply.createSlide === "object" &&
						reply.createSlide !== null
					) {
						const slideId =
							(reply.createSlide as Record<string, unknown>).objectId ??
							"Unknown";
						lines.push(`  Request ${i + 1}: Created slide with ID ${slideId}`);
					} else if (
						reply.createShape !== undefined &&
						typeof reply.createShape === "object" &&
						reply.createShape !== null
					) {
						const shapeId =
							(reply.createShape as Record<string, unknown>).objectId ??
							"Unknown";
						lines.push(`  Request ${i + 1}: Created shape with ID ${shapeId}`);
					} else {
						lines.push(`  Request ${i + 1}: Operation completed`);
					}
				}
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 4. get_page ───────────────────────────────────────────────────────────
	server.tool(
		"get_page",
		[
			"Get details about a specific slide/page in a presentation, including all element IDs,",
			"types, and text content. Use the returned element IDs with batch_update_presentation",
			"to target shapes for insertText or style updates.",
		].join(" "),
		{
			presentation_id: z.string().describe("ID of the presentation."),
			page_object_id: z
				.string()
				.describe("Object ID of the slide/page to retrieve."),
		},
		async ({ presentation_id, page_object_id }) => {
			const { accessToken } = await ctx.getService("gslides");
			const result = (await slidesFetch(
				accessToken,
				`${SLIDES_BASE}/presentations/${encodeURIComponent(presentation_id)}/pages/${encodeURIComponent(page_object_id)}`,
			)) as PageResponse;

			const pageType = result.pageType ?? "Unknown";
			const pageElements = result.pageElements ?? [];
			const elementsInfo = describeElements(pageElements);

			const text = [
				"Page Details:",
				`- Presentation ID: ${presentation_id}`,
				`- Page ID: ${page_object_id}`,
				`- Page Type: ${pageType}`,
				`- Total Elements: ${pageElements.length}`,
				"",
				"Page Elements:",
				elementsInfo.length > 0
					? elementsInfo.join("\n")
					: "  No elements found",
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 5. get_page_thumbnail ─────────────────────────────────────────────────
	server.tool(
		"get_page_thumbnail",
		"Generate a PNG thumbnail URL for a specific slide. The returned URL is temporary (Google-hosted).",
		{
			presentation_id: z.string().describe("ID of the presentation."),
			page_object_id: z
				.string()
				.describe("Object ID of the slide/page to thumbnail."),
			thumbnail_size: z
				.enum(["LARGE", "MEDIUM", "SMALL"])
				.default("MEDIUM")
				.describe(
					'Thumbnail size: "LARGE", "MEDIUM", or "SMALL". Defaults to "MEDIUM".',
				),
		},
		async ({ presentation_id, page_object_id, thumbnail_size }) => {
			const { accessToken } = await ctx.getService("gslides");
			const url = buildUrl(
				`${SLIDES_BASE}/presentations/${encodeURIComponent(presentation_id)}/pages/${encodeURIComponent(page_object_id)}/thumbnail`,
				{
					"thumbnailProperties.thumbnailSize": thumbnail_size,
					"thumbnailProperties.mimeType": "PNG",
				},
			);
			const result = (await slidesFetch(accessToken, url)) as ThumbnailResponse;
			const thumbnailUrl = result.contentUrl ?? "";

			const text = [
				"Thumbnail Generated:",
				`- Presentation ID: ${presentation_id}`,
				`- Page ID: ${page_object_id}`,
				`- Thumbnail Size: ${thumbnail_size}`,
				`- Thumbnail URL: ${thumbnailUrl}`,
				"",
				"You can view or download the thumbnail using the provided URL.",
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 6. list_presentation_comments ────────────────────────────────────────
	// Uses gdrive service (Drive v3 API) — presentations scope has no comment access.
	server.tool(
		"list_presentation_comments",
		"List all comments on a Google Slides presentation (uses Drive API).",
		{
			presentation_id: z
				.string()
				.describe("ID of the presentation to list comments for."),
			max_comments: z
				.number()
				.int()
				.optional()
				.describe("Maximum number of comments to return (default 100)."),
		},
		async ({ presentation_id, max_comments }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const limit = Math.max(0, max_comments ?? 100);
			if (limit === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No comments found in presentation ${presentation_id}`,
						},
					],
				};
			}
			const text = await listCommentsImpl(accessToken, presentation_id, limit);
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 7. manage_presentation_comment ───────────────────────────────────────
	// Uses gdrive service (Drive v3 API) — full drive scope for create/reply/resolve.
	server.tool(
		"manage_presentation_comment",
		[
			"Create, reply to, or resolve a comment on a Google Slides presentation.",
			"create: requires comment_content.",
			"reply: requires comment_id and comment_content.",
			"resolve: requires comment_id.",
			"Note: Drive API comments are presentation-level only; they cannot be anchored to specific slide elements.",
		].join(" "),
		{
			presentation_id: z
				.string()
				.describe("ID of the presentation to manage comments on."),
			action: z
				.enum(["create", "reply", "resolve"])
				.describe('Action: "create", "reply", or "resolve".'),
			comment_content: z
				.string()
				.optional()
				.describe("Comment or reply text (required for create and reply)."),
			comment_id: z
				.string()
				.optional()
				.describe("ID of the comment to reply to or resolve."),
		},
		async ({ presentation_id, action, comment_content, comment_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			let text: string;

			if (action === "create") {
				if (!comment_content)
					throw new Error("comment_content is required for the create action.");
				text = await createCommentImpl(
					accessToken,
					presentation_id,
					comment_content,
				);
			} else if (action === "reply") {
				if (!comment_id || !comment_content)
					throw new Error(
						"comment_id and comment_content are required for the reply action.",
					);
				text = await replyToCommentImpl(
					accessToken,
					presentation_id,
					comment_id,
					comment_content,
				);
			} else {
				// resolve
				if (!comment_id)
					throw new Error("comment_id is required for the resolve action.");
				text = await resolveCommentImpl(
					accessToken,
					presentation_id,
					comment_id,
				);
			}

			return { content: [{ type: "text" as const, text }] };
		},
	);
}
