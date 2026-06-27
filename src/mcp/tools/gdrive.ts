// Google Drive tools — 16 tools for the `gdrive` service.
//
// Module pattern: export function register(server: McpServer, ctx: ToolContext): void
//
// Workers-runtime notes:
//   • file_path / file:// URLs → not supported (no local filesystem); use file_url instead
//   • PDF / Office XML text extraction → not supported (no pdfminer/zipfile)
//   • get_drive_file_download_url → stateless-mode behaviour (base64 preview + metadata)
//   • Large file uploads via file_url use plain fetch(); no SSRF-safe stream lib

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API endpoints ─────────────────────────────────────────────────────────────

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// ─── MIME type constants ───────────────────────────────────────────────────────

const GOOGLE_DOCS_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const IMAGE_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/tiff",
	"image/svg+xml",
]);

const OFFICE_XML_MIME_TYPES = new Set([
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// ─── Import format maps ─────────────────────────────────────────────────────────
// Keys are dot-prefixed extensions matching drive_helpers.py exactly.

const GOOGLE_DOCS_IMPORT_FORMATS: Record<string, string> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".text": "text/plain",
	".html": "text/html",
	".htm": "text/html",
	".docx":
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".doc": "application/msword",
	".rtf": "application/rtf",
	".odt": "application/vnd.oasis.opendocument.text",
};

const GOOGLE_SHEETS_IMPORT_FORMATS: Record<string, string> = {
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xls": "application/vnd.ms-excel",
	".ods": "application/vnd.oasis.opendocument.spreadsheet",
	".csv": "text/csv",
	".tsv": "text/tab-separated-values",
};

const GOOGLE_SLIDES_IMPORT_FORMATS: Record<string, string> = {
	".pptx":
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".ppt": "application/vnd.ms-powerpoint",
	".odp": "application/vnd.oasis.opendocument.presentation",
};

const IMPORT_FORMATS_BY_GOOGLE_MIME: Record<string, Record<string, string>> = {
	[GOOGLE_DOCS_MIME]: GOOGLE_DOCS_IMPORT_FORMATS,
	[GOOGLE_SHEETS_MIME]: GOOGLE_SHEETS_IMPORT_FORMATS,
	[GOOGLE_SLIDES_MIME]: GOOGLE_SLIDES_IMPORT_FORMATS,
};

// Source MIME types that can be supplied as a plain string via `content`.
const TEXT_BASED_IMPORT_MIMES = new Set([
	"text/plain",
	"text/markdown",
	"text/html",
	"text/csv",
	"text/tab-separated-values",
	"application/rtf",
]);

// ─── Drive query patterns (mirrors drive_helpers.py DRIVE_QUERY_PATTERNS) ─────

const DRIVE_QUERY_PATTERNS: RegExp[] = [
	/\b\w+\s*(=|!=|>|<)\s*['"].*?['"]/i,
	/\b\w+\s*(=|!=|>|<)\s*\d+/i,
	/\bcontains\b/i,
	/\bin\s+parents\b/i,
	/\bhas\s*\{/i,
	/\btrashed\s*=\s*(true|false)\b/i,
	/\bstarred\s*=\s*(true|false)\b/i,
	/['"][^'"]+['"]\s+in\s+parents/i,
	/\bfullText\s+contains\b/i,
	/\bname\s*(=|contains)\b/i,
	/\bmimeType\s*(=|!=)\b/i,
];

// ─── File type MIME map (mirrors drive_helpers.py FILE_TYPE_MIME_MAP) ─────────

const FILE_TYPE_MIME_MAP: Record<string, string> = {
	folder: FOLDER_MIME,
	folders: FOLDER_MIME,
	document: GOOGLE_DOCS_MIME,
	doc: GOOGLE_DOCS_MIME,
	documents: GOOGLE_DOCS_MIME,
	docs: GOOGLE_DOCS_MIME,
	spreadsheet: GOOGLE_SHEETS_MIME,
	sheet: GOOGLE_SHEETS_MIME,
	spreadsheets: GOOGLE_SHEETS_MIME,
	sheets: GOOGLE_SHEETS_MIME,
	presentation: GOOGLE_SLIDES_MIME,
	presentations: GOOGLE_SLIDES_MIME,
	slide: GOOGLE_SLIDES_MIME,
	slides: GOOGLE_SLIDES_MIME,
	form: "application/vnd.google-apps.form",
	forms: "application/vnd.google-apps.form",
	drawing: "application/vnd.google-apps.drawing",
	drawings: "application/vnd.google-apps.drawing",
	pdf: "application/pdf",
	pdfs: "application/pdf",
	shortcut: SHORTCUT_MIME,
	shortcuts: SHORTCUT_MIME,
	script: "application/vnd.google-apps.script",
	scripts: "application/vnd.google-apps.script",
	site: "application/vnd.google-apps.site",
	sites: "application/vnd.google-apps.site",
	jam: "application/vnd.google-apps.jam",
	jamboard: "application/vnd.google-apps.jam",
	jamboards: "application/vnd.google-apps.jam",
};

// ─── Response type interfaces ─────────────────────────────────────────────────

interface DrivePermission {
	id?: string;
	type?: string;
	role?: string;
	emailAddress?: string;
	domain?: string;
	displayName?: string;
	expirationTime?: string;
	permissionDetails?: Array<{ inherited?: boolean; inheritedFrom?: string }>;
}

interface DriveFile {
	id?: string;
	name?: string;
	mimeType?: string;
	size?: string;
	parents?: string[];
	createdTime?: string;
	modifiedTime?: string;
	trashed?: boolean;
	driveId?: string;
	webViewLink?: string;
	webContentLink?: string;
	shared?: boolean;
	starred?: boolean;
	writersCanShare?: boolean;
	copyRequiresWriterPermission?: boolean;
	owners?: Array<{ displayName?: string; emailAddress?: string }>;
	permissions?: DrivePermission[];
	sharingUser?: { displayName?: string; emailAddress?: string };
	lastModifyingUser?: { displayName?: string; emailAddress?: string };
	shortcutDetails?: { targetId?: string; targetMimeType?: string };
	properties?: Record<string, string>;
	description?: string;
}

interface DriveFilesListResponse {
	files?: DriveFile[];
	nextPageToken?: string;
}

interface DriveDrive {
	id?: string;
	name?: string;
	createdTime?: string;
	hidden?: boolean;
	restrictions?: Record<string, unknown>;
	capabilities?: Record<string, unknown>;
}

interface DriveDrivesListResponse {
	drives?: DriveDrive[];
	nextPageToken?: string;
}

interface DrivePermissionsListResponse {
	permissions?: DrivePermission[];
	nextPageToken?: string;
}

// ─── URL builder ──────────────────────────────────────────────────────────────

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

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatPermissionInfo(perm: DrivePermission): string {
	const permType = perm.type ?? "unknown";
	const role = perm.role ?? "unknown";
	const permId = perm.id ?? "";
	let base: string;

	if (permType === "anyone") {
		base = `Anyone with the link (${role}) [id: ${permId}]`;
	} else if (permType === "user") {
		base = `User: ${perm.emailAddress ?? "unknown"} (${role}) [id: ${permId}]`;
	} else if (permType === "group") {
		base = `Group: ${perm.emailAddress ?? "unknown"} (${role}) [id: ${permId}]`;
	} else if (permType === "domain") {
		base = `Domain: ${perm.domain ?? "unknown"} (${role}) [id: ${permId}]`;
	} else {
		base = `${permType} (${role}) [id: ${permId}]`;
	}

	const extras: string[] = [];
	if (perm.expirationTime) extras.push(`expires: ${perm.expirationTime}`);
	if (perm.permissionDetails) {
		for (const d of perm.permissionDetails) {
			if (d.inherited && d.inheritedFrom) {
				extras.push(`inherited from: ${d.inheritedFrom}`);
				break;
			}
		}
	}
	return extras.length > 0 ? `${base} | ${extras.join(", ")}` : base;
}

function checkPublicLinkPermission(permissions: DrivePermission[]): boolean {
	return permissions.some(
		(p) =>
			p.type === "anyone" &&
			(p.role === "reader" || p.role === "writer" || p.role === "commenter"),
	);
}

function getDriveImageUrl(fileId: string): string {
	return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

function resolveFileTypeMime(fileType: string): string {
	const normalized = fileType.trim();
	if (!normalized) throw new Error("file_type cannot be empty.");
	if (normalized.includes("/")) return normalized.toLowerCase();
	const lower = normalized.toLowerCase();
	if (lower in FILE_TYPE_MIME_MAP) return FILE_TYPE_MIME_MAP[lower];
	throw new Error(
		`Unknown file_type '${fileType}'. Pass a MIME type directly (e.g. 'application/pdf') or use a friendly name.`,
	);
}

// ─── Validation helpers ────────────────────────────────────────────────────────

const VALID_SHARE_ROLES = new Set(["reader", "commenter", "writer"]);
const VALID_SHARE_TYPES = new Set(["user", "group", "domain", "anyone"]);
const RFC3339_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validateShareRole(role: string): void {
	if (!VALID_SHARE_ROLES.has(role))
		throw new Error(
			`Invalid role '${role}'. Must be one of: ${[...VALID_SHARE_ROLES].sort().join(", ")}`,
		);
}

function validateShareType(type: string): void {
	if (!VALID_SHARE_TYPES.has(type))
		throw new Error(
			`Invalid share_type '${type}'. Must be one of: ${[...VALID_SHARE_TYPES].sort().join(", ")}`,
		);
}

function validateExpirationTime(t: string): void {
	if (!RFC3339_PATTERN.test(t))
		throw new Error(
			`Invalid expiration_time '${t}'. Must be RFC 3339 format (e.g., '2025-01-15T00:00:00Z')`,
		);
}

// ─── Shortcut resolution ──────────────────────────────────────────────────────

async function resolveFileId(
	accessToken: string,
	fileId: string,
	extraFields = "",
): Promise<{ id: string; meta: DriveFile }> {
	const baseFields = "id,mimeType,shortcutDetails";
	const fields = extraFields ? `${baseFields},${extraFields}` : baseFields;
	const url = buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
		fields,
		supportsAllDrives: true,
	});
	const meta = (await googleApiFetch(accessToken, url)) as DriveFile;
	if (meta.mimeType === SHORTCUT_MIME && meta.shortcutDetails?.targetId) {
		const targetId = meta.shortcutDetails.targetId;
		const targetUrl = buildUrl(
			`${DRIVE_BASE}/files/${encodeURIComponent(targetId)}`,
			{ fields, supportsAllDrives: true },
		);
		const targetMeta = (await googleApiFetch(
			accessToken,
			targetUrl,
		)) as DriveFile;
		return { id: targetId, meta: targetMeta };
	}
	return { id: meta.id ?? fileId, meta };
}

async function resolveFolderId(
	accessToken: string,
	folderId: string,
): Promise<string> {
	if (folderId === "root") return "root";
	const { id } = await resolveFileId(accessToken, folderId);
	return id;
}

// ─── Base64 helper (chunked to avoid stack overflow) ──────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
	const CHUNK = 8192;
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// ─── Raw drive fetch (for alt=media / export downloads) ───────────────────────

async function driveFetchBytes(
	accessToken: string,
	url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
	const resp = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`Google Drive ${resp.status}: ${body}`);
	}
	return {
		bytes: new Uint8Array(await resp.arrayBuffer()),
		contentType: resp.headers.get("Content-Type") ?? "application/octet-stream",
	};
}

// ─── Multipart upload helper ──────────────────────────────────────────────────

async function driveMultipartUpload(
	accessToken: string,
	method: "POST" | "PATCH",
	url: string,
	metadata: Record<string, unknown>,
	content: Uint8Array,
	contentMimeType: string,
): Promise<unknown> {
	const boundary = `drive_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const metaJson = JSON.stringify(metadata);
	const enc = new TextEncoder();
	const part1 = enc.encode(
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${contentMimeType}\r\n\r\n`,
	);
	const part3 = enc.encode(`\r\n--${boundary}--`);
	const body = new Uint8Array(part1.length + content.length + part3.length);
	body.set(part1, 0);
	body.set(content, part1.length);
	body.set(part3, part1.length + content.length);
	const resp = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": `multipart/related; boundary="${boundary}"`,
		},
		body,
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Google Drive upload ${resp.status}: ${text}`);
	}
	return resp.json();
}

// ─── Import content resolver (Workers adaptation of _resolve_import_media) ────

async function resolveImportContent(
	toolName: string,
	fileName: string,
	content: string | undefined,
	fileUrl: string | undefined,
	sourceFormat: string | undefined,
	formatMap: Record<string, string>,
): Promise<{ bytes: Uint8Array; sourceMimeType: string }> {
	if (content === undefined && fileUrl === undefined) {
		throw new Error(
			"You must provide one of: 'content' or 'file_url'. " +
				"'file_path' is not supported in this runtime (no local filesystem).",
		);
	}
	if (content !== undefined && fileUrl !== undefined) {
		throw new Error("Provide only one of: 'content' or 'file_url'.");
	}

	// Determine source MIME type from hint or auto-detection
	let sourceMimeType: string;
	if (sourceFormat) {
		const key = `.${sourceFormat.toLowerCase().replace(/^\./, "")}`;
		if (!(key in formatMap)) {
			throw new Error(
				`Unsupported source_format: '${sourceFormat}'. Supported: ${Object.keys(
					formatMap,
				)
					.map((k) => k.slice(1))
					.join(", ")}`,
			);
		}
		sourceMimeType = formatMap[key];
	} else {
		const detectionName =
			fileUrl !== undefined
				? (() => {
						try {
							return new URL(fileUrl).pathname || fileUrl;
						} catch {
							return fileUrl;
						}
					})()
				: fileName;
		const ext = `.${detectionName.split(".").pop()?.toLowerCase() ?? ""}`;
		if (ext in formatMap) {
			sourceMimeType = formatMap[ext];
		} else if (
			content !== undefined &&
			(content.startsWith("#") ||
				content.includes("```") ||
				content.includes("**"))
		) {
			sourceMimeType = "text/markdown";
		} else {
			sourceMimeType = "text/plain";
		}
	}

	// Validate against allowlist
	if (!Object.values(formatMap).includes(sourceMimeType)) {
		throw new Error(
			`[${toolName}] Source MIME type '${sourceMimeType}' is not supported. ` +
				`Supported: ${Object.keys(formatMap)
					.map((k) => k.slice(1))
					.join(", ")}.`,
		);
	}

	let bytes: Uint8Array;

	if (content !== undefined) {
		if (!TEXT_BASED_IMPORT_MIMES.has(sourceMimeType)) {
			throw new Error(
				`'content' is only valid for text-based formats, but source resolves to '${sourceMimeType}' ` +
					`(a binary format). Provide a 'file_url' for binary formats.`,
			);
		}
		bytes = new TextEncoder().encode(content);
	} else {
		// fileUrl must be defined here (only two branches)
		const url = fileUrl as string;
		const resp = await fetch(url);
		if (!resp.ok)
			throw new Error(`Failed to fetch '${url}': HTTP ${resp.status}`);
		bytes = new Uint8Array(await resp.arrayBuffer());
		// Prefer Content-Type from response if no explicit hint given
		if (!sourceFormat) {
			const ct = (resp.headers.get("Content-Type") ?? "").split(";")[0].trim();
			if (ct && Object.values(formatMap).includes(ct)) sourceMimeType = ct;
		}
	}

	return { bytes, sourceMimeType };
}

// ─── List URL params builder ───────────────────────────────────────────────────

function buildListParams(
	query: string,
	pageSize: number,
	driveId: string | undefined,
	includeItemsFromAllDrives: boolean,
	corpora: string | undefined,
	pageToken: string | undefined,
	detailed: boolean,
	includePermissions: boolean,
	orderBy: string | undefined,
): Record<string, string | number | boolean | null | undefined> {
	let fields: string;
	if (detailed) {
		const permFields = includePermissions
			? ", permissions(id, type, role)"
			: "";
		fields =
			"nextPageToken, files(id, name, mimeType, webViewLink, iconLink," +
			" modifiedTime, createdTime, size, driveId," +
			` lastModifyingUser(displayName, emailAddress)${permFields})`;
	} else {
		fields = "nextPageToken, files(id, name, mimeType)";
	}

	const result: Record<string, string | number | boolean | null | undefined> = {
		q: query,
		pageSize,
		fields,
		supportsAllDrives: true,
		includeItemsFromAllDrives,
		pageToken,
	};

	if (orderBy?.trim()) result.orderBy = orderBy.trim();

	if (driveId) {
		result.driveId = driveId;
		result.corpora = corpora ?? "drive";
	} else if (corpora) {
		result.corpora = corpora;
	}

	return result;
}

// ─── Format file item for list output ─────────────────────────────────────────

function formatFileItem(file: DriveFile, detailed: boolean): string {
	if (!detailed) {
		return `- Name: "${file.name ?? "Unknown"}" (ID: ${file.id ?? "N/A"}, Type: ${file.mimeType ?? "Unknown"})`;
	}
	const sizeStr = file.size ? `, Size: ${file.size}` : "";
	const createdStr = file.createdTime ? `, Created: ${file.createdTime}` : "";
	const driveIdStr = file.driveId ? `, Drive ID: ${file.driveId}` : "";
	const lmu = file.lastModifyingUser;
	let lastEditedStr = "";
	if (lmu) {
		if (lmu.displayName && lmu.emailAddress)
			lastEditedStr = `, Last Edited By: ${lmu.displayName} <${lmu.emailAddress}>`;
		else if (lmu.displayName)
			lastEditedStr = `, Last Edited By: ${lmu.displayName}`;
		else if (lmu.emailAddress)
			lastEditedStr = `, Last Edited By: ${lmu.emailAddress}`;
	}
	return (
		`- Name: "${file.name ?? "Unknown"}" (ID: ${file.id ?? "N/A"}, Type: ${file.mimeType ?? "Unknown"}${sizeStr}` +
		`${createdStr}, Modified: ${file.modifiedTime ?? "N/A"}${lastEditedStr}${driveIdStr})` +
		` Link: ${file.webViewLink ?? "#"}`
	);
}

// ─── Export MIME type resolution ──────────────────────────────────────────────

function resolveExportMime(
	mimeType: string,
	exportFormat: string | undefined,
): { exportMimeType: string; extension: string } | null {
	if (mimeType === GOOGLE_DOCS_MIME) {
		if (exportFormat === "docx")
			return {
				exportMimeType:
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				extension: ".docx",
			};
		return { exportMimeType: "application/pdf", extension: ".pdf" };
	}
	if (mimeType === GOOGLE_SHEETS_MIME) {
		if (exportFormat === "csv")
			return { exportMimeType: "text/csv", extension: ".csv" };
		if (exportFormat === "pdf")
			return { exportMimeType: "application/pdf", extension: ".pdf" };
		return {
			exportMimeType:
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			extension: ".xlsx",
		};
	}
	if (mimeType === GOOGLE_SLIDES_MIME) {
		if (exportFormat === "pptx")
			return {
				exportMimeType:
					"application/vnd.openxmlformats-officedocument.presentationml.presentation",
				extension: ".pptx",
			};
		return { exportMimeType: "application/pdf", extension: ".pdf" };
	}
	return null;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. search_drive_files ──────────────────────────────────────────────────
	server.tool(
		"search_drive_files",
		"Search for files and folders in Google Drive using structured Drive query syntax or free text.",
		{
			query: z
				.string()
				.describe(
					"Search query. Can be a Drive API query (name contains 'foo') or free text (automatically wrapped in fullText contains).",
				),
			page_size: z
				.number()
				.int()
				.default(10)
				.describe("Max results to return (default 10)."),
			page_token: z
				.string()
				.optional()
				.describe("nextPageToken from a previous response for pagination."),
			drive_id: z
				.string()
				.optional()
				.describe("Shared drive ID to scope the search."),
			include_items_from_all_drives: z
				.boolean()
				.default(true)
				.describe("Include shared drive items (default true)."),
			corpora: z
				.string()
				.optional()
				.describe(
					"Bodies to query: 'user', 'domain', 'drive', or 'allDrives'.",
				),
			file_type: z
				.string()
				.optional()
				.describe(
					"Restrict to a file type: friendly name ('folder', 'doc', 'sheet', 'pdf', …) or raw MIME type.",
				),
			detailed: z
				.boolean()
				.default(true)
				.describe("Include size, modified time, and link in results."),
			order_by: z
				.string()
				.optional()
				.describe(
					"Sort order (e.g. 'modifiedTime desc'). Valid keys: createdTime, folder, modifiedTime, name, recency, etc.",
				),
		},
		async ({
			query,
			page_size,
			page_token,
			drive_id,
			include_items_from_all_drives,
			corpora,
			file_type,
			detailed,
			order_by,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");
			const isStructured = DRIVE_QUERY_PATTERNS.some((p) => p.test(query));
			const escaped = query.replace(/'/g, "\\'");
			let finalQuery = isStructured ? query : `fullText contains '${escaped}'`;
			if (file_type) {
				const mime = resolveFileTypeMime(file_type);
				finalQuery = `(${finalQuery}) and mimeType = '${mime}'`;
			}
			const params = buildListParams(
				finalQuery,
				page_size,
				drive_id,
				include_items_from_all_drives,
				corpora,
				page_token,
				detailed,
				detailed, // includePermissions when detailed
				order_by,
			);
			const url = buildUrl(`${DRIVE_BASE}/files`, params);
			const data = (await googleApiFetch(
				accessToken,
				url,
			)) as DriveFilesListResponse;
			const files = data.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{ type: "text" as const, text: `No files found for '${query}'.` },
					],
				};
			}
			const lines = [`Found ${files.length} files matching '${query}':`];
			for (const f of files) lines.push(formatFileItem(f, detailed));
			if (data.nextPageToken)
				lines.push(`nextPageToken: ${data.nextPageToken}`);
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 2. get_drive_file_content ──────────────────────────────────────────────
	server.tool(
		"get_drive_file_content",
		"Read the content of a Google Drive file inline. Native Google Docs/Sheets/Slides are exported as text/CSV. Images are returned as base64. PDF and Office XML cannot have text extracted in this runtime.",
		{
			file_id: z.string().describe("Google Drive file ID or shortcut ID."),
		},
		async ({ file_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { id: resolvedId, meta } = await resolveFileId(
				accessToken,
				file_id,
				"name,mimeType,webViewLink",
			);
			const mimeType = meta.mimeType ?? "";
			const fileName = meta.name ?? "Unknown File";
			const webViewLink = meta.webViewLink ?? "#";

			// Determine download strategy
			const exportMimeMap: Record<string, string> = {
				[GOOGLE_DOCS_MIME]: "text/plain",
				[GOOGLE_SHEETS_MIME]: "text/csv",
				[GOOGLE_SLIDES_MIME]: "text/plain",
			};
			const exportMime = exportMimeMap[mimeType];

			const downloadUrl = exportMime
				? buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/export`,
						{ mimeType: exportMime },
					)
				: buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`, {
						alt: "media",
					});

			const { bytes } = await driveFetchBytes(accessToken, downloadUrl);

			let bodyText: string;
			if (exportMime) {
				// Native Google Apps file: decoded text
				bodyText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
			} else if (OFFICE_XML_MIME_TYPES.has(mimeType)) {
				bodyText =
					`[Office XML text extraction (DOCX/XLSX/PPTX) is not supported in this runtime. ` +
					`File size: ${bytes.length} bytes. Use get_drive_file_download_url to retrieve the file as base64.]`;
			} else if (mimeType === "application/pdf") {
				bodyText =
					`[PDF text extraction is not supported in this runtime. ` +
					`File size: ${bytes.length} bytes. Use get_drive_file_download_url to retrieve the file as base64.]`;
			} else if (IMAGE_MIME_TYPES.has(mimeType)) {
				const b64 = uint8ArrayToBase64(bytes);
				bodyText = `[base64_image:${mimeType}]${b64}`;
			} else {
				const decoded = new TextDecoder("utf-8", { fatal: true });
				try {
					bodyText = decoded.decode(bytes);
				} catch {
					bodyText =
						`[Binary or unsupported text encoding for mimeType '${mimeType}' - ` +
						`${bytes.length} bytes]`;
				}
			}

			const header =
				`File: "${fileName}" (ID: ${resolvedId}, Type: ${mimeType})\n` +
				`Link: ${webViewLink}\n\n--- CONTENT ---\n`;
			return {
				content: [{ type: "text" as const, text: header + bodyText }],
			};
		},
	);

	// ── 3. get_drive_file_download_url ─────────────────────────────────────────
	server.tool(
		"get_drive_file_download_url",
		"Download a Google Drive file and return its metadata and a base64 preview. In this Workers runtime, files cannot be saved locally; the first 100 bytes are shown as base64. Use get_drive_file_content for text-readable content.",
		{
			file_id: z.string().describe("Google Drive file ID."),
			export_format: z
				.string()
				.optional()
				.describe(
					"Export format for Google native files: 'pdf' (default for Docs/Slides), 'docx', 'xlsx', 'csv', 'pptx'.",
				),
		},
		async ({ file_id, export_format }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { id: resolvedId, meta } = await resolveFileId(
				accessToken,
				file_id,
				"name,mimeType,webViewLink,webContentLink",
			);
			const mimeType = meta.mimeType ?? "";
			const fileName = meta.name ?? "Unknown File";

			const exportInfo = resolveExportMime(mimeType, export_format);
			let outputMimeType = mimeType;
			let outputFileName = fileName;

			if (exportInfo) {
				outputMimeType = exportInfo.exportMimeType;
				const stem = fileName.replace(/\.[^.]+$/, "");
				outputFileName = stem + exportInfo.extension;
			}

			const downloadUrl = exportInfo
				? buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/export`,
						{ mimeType: exportInfo.exportMimeType },
					)
				: buildUrl(`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`, {
						alt: "media",
					});

			const { bytes } = await driveFetchBytes(accessToken, downloadUrl);
			const sizeKb = (bytes.length / 1024).toFixed(1);
			const preview = uint8ArrayToBase64(bytes.slice(0, 100));

			const lines = [
				"File downloaded successfully!",
				`File: ${outputFileName}`,
				`File ID: ${resolvedId}`,
				`Size: ${sizeKb} KB (${bytes.length} bytes)`,
				`MIME Type: ${outputMimeType}`,
				"",
				"Workers runtime: local file storage not available.",
				"Base64-encoded content (first 100 bytes shown):",
				`${preview}...`,
			];
			if (exportInfo) {
				lines.push(
					`\nNote: Google native file exported to ${outputMimeType} format.`,
				);
			}
			lines.push(`View link: ${meta.webViewLink ?? "N/A"}`);
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 4. list_drive_items ────────────────────────────────────────────────────
	server.tool(
		"list_drive_items",
		"List files/folders in a Drive folder or list shared drive containers (resource_type='shared_drives').",
		{
			folder_id: z
				.string()
				.default("root")
				.describe("Folder ID to list ('root' for My Drive root)."),
			page_size: z
				.number()
				.int()
				.default(100)
				.describe("Max items to return (default 100)."),
			page_token: z
				.string()
				.optional()
				.describe("nextPageToken from a previous response."),
			drive_id: z.string().optional().describe("Shared drive ID."),
			include_items_from_all_drives: z
				.boolean()
				.default(true)
				.describe("Include shared drive items (default true)."),
			corpora: z
				.string()
				.optional()
				.describe("Corpus: 'user', 'drive', or 'allDrives'."),
			file_type: z
				.string()
				.optional()
				.describe("Filter by file type (friendly name or MIME type)."),
			detailed: z
				.boolean()
				.default(true)
				.describe("Include size, modified time, link."),
			order_by: z.string().optional().describe("Sort order for items."),
			resource_type: z
				.string()
				.default("items")
				.describe(
					"'items' for folder contents, 'shared_drives' to list shared drive containers.",
				),
			query: z
				.string()
				.optional()
				.describe(
					"Query filter for shared_drives listing (e.g. \"name contains 'Engineering'\").",
				),
			include_organizers: z
				.boolean()
				.default(false)
				.describe(
					"When listing shared_drives, also fetch organizer permissions (extra API calls).",
				),
		},
		async ({
			folder_id,
			page_size,
			page_token,
			drive_id,
			include_items_from_all_drives,
			corpora,
			file_type,
			detailed,
			order_by,
			resource_type,
			query,
			include_organizers,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");

			// Shared drives listing path
			if (resource_type.toLowerCase().trim() === "shared_drives") {
				const driveParams: Record<string, string | number | null | undefined> =
					{
						pageSize: Math.min(Math.max(page_size, 1), 100),
						fields:
							"drives(id, name, createdTime, hidden, restrictions, capabilities(canManageMembers, canEdit)), nextPageToken",
						pageToken: page_token,
						q: query,
					};
				const drivesUrl = buildUrl(`${DRIVE_BASE}/drives`, driveParams);
				const drivesData = (await googleApiFetch(
					accessToken,
					drivesUrl,
				)) as DriveDrivesListResponse;
				const drives = drivesData.drives ?? [];
				if (drives.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: "No shared drives found.",
							},
						],
					};
				}

				// Fetch organizers in parallel if requested
				const organizerMap = new Map<
					string,
					{ organizers: DrivePermission[]; error?: string }
				>();
				if (include_organizers) {
					await Promise.all(
						drives.map(async (d) => {
							if (!d.id) return;
							try {
								const permUrl = buildUrl(
									`${DRIVE_BASE}/files/${encodeURIComponent(d.id)}/permissions`,
									{
										supportsAllDrives: true,
										useDomainAdminAccess: false,
										fields:
											"nextPageToken, permissions(emailAddress, displayName, role, type, domain)",
										pageSize: 100,
									},
								);
								const permData = (await googleApiFetch(
									accessToken,
									permUrl,
								)) as DrivePermissionsListResponse;
								const all = permData.permissions ?? [];
								organizerMap.set(d.id, {
									organizers: all.filter((p) => p.role === "organizer"),
								});
							} catch (err) {
								organizerMap.set(d.id, {
									organizers: [],
									error: String(err),
								});
							}
						}),
					);
				}

				const parts = [`Found ${drives.length} shared drives:`];
				for (const d of drives) {
					const caps = (d.capabilities as Record<string, unknown>) ?? {};
					const rest = (d.restrictions as Record<string, unknown>) ?? {};
					const capFlags =
						Object.entries(caps)
							.filter(([, v]) => v)
							.map(([k]) => k)
							.join(", ") || "none";
					const restFlags =
						Object.entries(rest)
							.filter(([, v]) => v)
							.map(([k]) => k)
							.join(", ") || "none";
					const hiddenFlag = d.hidden ? " [hidden]" : "";
					parts.push(
						`- Name: "${d.name ?? "Unknown"}" (ID: ${d.id ?? "N/A"}, Created: ${d.createdTime ?? "N/A"})${hiddenFlag} ` +
							`Capabilities: ${capFlags}; Restrictions: ${restFlags}`,
					);
					if (include_organizers && d.id) {
						const orgInfo = organizerMap.get(d.id);
						if (!orgInfo || orgInfo.error) {
							parts.push(
								`  Organizers: <error: ${orgInfo?.error ?? "unknown"}>`,
							);
						} else if (orgInfo.organizers.length === 0) {
							parts.push("  Organizers: <none returned>");
						} else {
							for (const o of orgInfo.organizers) {
								const identifier = o.emailAddress ?? o.domain ?? o.type ?? "?";
								const display = o.displayName;
								const suffix =
									display && display !== identifier ? ` ("${display}")` : "";
								parts.push(
									`  Organizer (${o.type ?? "?"}): ${identifier}${suffix}`,
								);
							}
						}
					}
				}
				if (drivesData.nextPageToken)
					parts.push(`nextPageToken: ${drivesData.nextPageToken}`);
				return {
					content: [{ type: "text" as const, text: parts.join("\n") }],
				};
			}

			if (resource_type.toLowerCase().trim() !== "items") {
				throw new Error("resource_type must be 'items' or 'shared_drives'.");
			}

			// Folder contents listing
			const resolvedFolderId = await resolveFolderId(accessToken, folder_id);
			let finalQuery = `'${resolvedFolderId}' in parents and trashed=false`;
			if (file_type) {
				const mime = resolveFileTypeMime(file_type);
				finalQuery = `(${finalQuery}) and mimeType = '${mime}'`;
			}
			const params = buildListParams(
				finalQuery,
				page_size,
				drive_id,
				include_items_from_all_drives,
				corpora,
				page_token,
				detailed,
				false,
				order_by,
			);
			const filesUrl = buildUrl(`${DRIVE_BASE}/files`, params);
			const data = (await googleApiFetch(
				accessToken,
				filesUrl,
			)) as DriveFilesListResponse;
			const files = data.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No items found in folder '${folder_id}'.`,
						},
					],
				};
			}
			const lines = [`Found ${files.length} items in folder '${folder_id}':`];
			for (const f of files) lines.push(formatFileItem(f, detailed));
			if (data.nextPageToken)
				lines.push(`nextPageToken: ${data.nextPageToken}`);
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 5. create_drive_folder ─────────────────────────────────────────────────
	server.tool(
		"create_drive_folder",
		"Create a new folder in Google Drive.",
		{
			folder_name: z.string().describe("Name for the new folder."),
			parent_folder_id: z
				.string()
				.default("root")
				.describe("Parent folder ID (default 'root')."),
		},
		async ({ folder_name, parent_folder_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const resolvedParent = await resolveFolderId(
				accessToken,
				parent_folder_id,
			);
			const body: Record<string, unknown> = {
				name: folder_name,
				parents: [resolvedParent],
				mimeType: FOLDER_MIME,
			};
			const url = buildUrl(`${DRIVE_BASE}/files`, {
				fields: "id,name,webViewLink",
				supportsAllDrives: true,
			});
			const created = (await googleApiFetch(accessToken, url, {
				method: "POST",
				body: JSON.stringify(body),
			})) as DriveFile;
			const text =
				`Successfully created folder '${created.name ?? folder_name}' ` +
				`(ID: ${created.id ?? "N/A"}) in '${parent_folder_id}'. ` +
				`Link: ${created.webViewLink ?? "N/A"}`;
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 6. create_drive_file ───────────────────────────────────────────────────
	server.tool(
		"create_drive_file",
		"Create a new file in Google Drive with text content, base64-encoded binary, or content fetched from a URL.",
		{
			file_name: z.string().describe("Name for the new file."),
			content: z.string().optional().describe("Text content for the file."),
			folder_id: z
				.string()
				.default("root")
				.describe("Parent folder ID (default 'root')."),
			mime_type: z
				.string()
				.default("text/plain")
				.describe("MIME type for the file."),
			fileUrl: z
				.string()
				.optional()
				.describe(
					"HTTP/HTTPS URL to fetch file content from. Note: file:// URLs are not supported in this runtime.",
				),
			base64_content: z
				.string()
				.optional()
				.describe("Standard base64-encoded file bytes."),
			content_mime_type: z
				.string()
				.optional()
				.describe(
					"MIME type of base64_content (required when using base64_content).",
				),
		},
		async ({
			file_name,
			content,
			folder_id,
			mime_type,
			fileUrl,
			base64_content,
			content_mime_type,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");

			// Validation mirrors drive_tools.py
			const hasContent = content !== undefined;
			const hasUrl = fileUrl !== undefined;
			const hasBase64 = base64_content !== undefined;
			if (!hasContent && !hasUrl && !hasBase64) {
				throw new Error(
					"You must provide one of: 'content', 'fileUrl', or 'base64_content'.",
				);
			}
			if (hasBase64 && (hasContent || hasUrl)) {
				throw new Error(
					"'base64_content' cannot be used with 'content' or 'fileUrl'.",
				);
			}
			if (hasBase64 && !content_mime_type) {
				throw new Error(
					"'content_mime_type' is required when using 'base64_content'.",
				);
			}

			const resolvedParent = await resolveFolderId(accessToken, folder_id);
			const fileMetadata: Record<string, unknown> = {
				name: file_name,
				parents: [resolvedParent],
				mimeType: mime_type,
			};

			let uploadBytes: Uint8Array;
			let uploadMimeType = mime_type;

			if (hasBase64) {
				const mimeForUpload = content_mime_type as string;
				try {
					const binaryStr = atob(base64_content as string);
					uploadBytes = new Uint8Array(binaryStr.length);
					for (let i = 0; i < binaryStr.length; i++) {
						uploadBytes[i] = binaryStr.charCodeAt(i);
					}
				} catch {
					throw new Error("'base64_content' must be valid standard base64.");
				}
				uploadMimeType = mimeForUpload;
				fileMetadata.mimeType = mimeForUpload;
			} else if (hasUrl) {
				const url = fileUrl as string;
				if (
					url.startsWith("file://") ||
					(!url.startsWith("http://") && !url.startsWith("https://"))
				) {
					throw new Error(
						"Only http:// and https:// URLs are supported in this runtime. file:// URLs are not available.",
					);
				}
				const resp = await fetch(url);
				if (!resp.ok)
					throw new Error(`Failed to fetch '${url}': HTTP ${resp.status}`);
				uploadBytes = new Uint8Array(await resp.arrayBuffer());
				const ct = (resp.headers.get("Content-Type") ?? "")
					.split(";")[0]
					.trim();
				if (ct && ct !== "application/octet-stream") {
					uploadMimeType = ct;
					fileMetadata.mimeType = ct;
				}
			} else {
				uploadBytes = new TextEncoder().encode(content as string);
			}

			const uploadUrl = buildUrl(`${DRIVE_UPLOAD}/files`, {
				uploadType: "multipart",
				fields: "id,name,webViewLink",
				supportsAllDrives: true,
			});
			const created = (await driveMultipartUpload(
				accessToken,
				"POST",
				uploadUrl,
				fileMetadata,
				uploadBytes,
				uploadMimeType,
			)) as DriveFile;

			const text =
				`Successfully created file '${created.name ?? file_name}' ` +
				`(ID: ${created.id ?? "N/A"}) in '${folder_id}'. ` +
				`Link: ${created.webViewLink ?? "N/A"}`;
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 7. import_to_google_doc ────────────────────────────────────────────────
	server.tool(
		"import_to_google_doc",
		"Import a file (Markdown, DOCX, TXT, HTML, RTF, ODT) into Google Docs format with automatic conversion. Provide content as a string or via file_url.",
		{
			file_name: z
				.string()
				.describe("Name for the new Google Doc (extension is ignored)."),
			content: z
				.string()
				.optional()
				.describe("Text content for text-based formats (MD, TXT, HTML)."),
			file_url: z
				.string()
				.optional()
				.describe("HTTP/HTTPS URL to fetch file from (DOCX, ODT, etc.)."),
			source_format: z
				.string()
				.optional()
				.describe(
					"Source format hint: md, txt, html, docx, odt, rtf. Auto-detected from file_name if omitted.",
				),
			folder_id: z
				.string()
				.default("root")
				.describe("Parent folder ID (default 'root')."),
		},
		async ({ file_name, content, file_url, source_format, folder_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { bytes, sourceMimeType } = await resolveImportContent(
				"import_to_google_doc",
				file_name,
				content,
				file_url,
				source_format,
				GOOGLE_DOCS_IMPORT_FORMATS,
			);
			const docName = file_name.replace(/\.[^.]+$/, "") || file_name;
			const resolvedParent = await resolveFolderId(accessToken, folder_id);
			const metadata: Record<string, unknown> = {
				name: docName,
				parents: [resolvedParent],
				mimeType: GOOGLE_DOCS_MIME,
			};
			const uploadUrl = buildUrl(`${DRIVE_UPLOAD}/files`, {
				uploadType: "multipart",
				fields: "id,name,webViewLink,mimeType",
				supportsAllDrives: true,
			});
			const created = (await driveMultipartUpload(
				accessToken,
				"POST",
				uploadUrl,
				metadata,
				bytes,
				sourceMimeType,
			)) as DriveFile;
			const text = [
				`Successfully imported '${docName}' as Google Doc`,
				`   Document ID: ${created.id ?? "N/A"}`,
				`   Source format: ${sourceMimeType}`,
				`   Folder: ${folder_id}`,
				`   Link: ${created.webViewLink ?? "N/A"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 8. import_to_google_slides ─────────────────────────────────────────────
	server.tool(
		"import_to_google_slides",
		"Import a presentation (PPTX, PPT, ODP) into Google Slides format with automatic conversion.",
		{
			file_name: z
				.string()
				.describe(
					"Name for the new Google Slides presentation (extension is ignored).",
				),
			file_url: z
				.string()
				.optional()
				.describe("HTTP/HTTPS URL to fetch the presentation from."),
			source_format: z
				.string()
				.optional()
				.describe("Source format hint: pptx, ppt, odp."),
			folder_id: z
				.string()
				.default("root")
				.describe("Parent folder ID (default 'root')."),
		},
		async ({ file_name, file_url, source_format, folder_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { bytes, sourceMimeType } = await resolveImportContent(
				"import_to_google_slides",
				file_name,
				undefined,
				file_url,
				source_format,
				GOOGLE_SLIDES_IMPORT_FORMATS,
			);
			const presName = file_name.replace(/\.[^.]+$/, "") || file_name;
			const resolvedParent = await resolveFolderId(accessToken, folder_id);
			const metadata: Record<string, unknown> = {
				name: presName,
				parents: [resolvedParent],
				mimeType: GOOGLE_SLIDES_MIME,
			};
			const uploadUrl = buildUrl(`${DRIVE_UPLOAD}/files`, {
				uploadType: "multipart",
				fields: "id,name,webViewLink,mimeType",
				supportsAllDrives: true,
			});
			const created = (await driveMultipartUpload(
				accessToken,
				"POST",
				uploadUrl,
				metadata,
				bytes,
				sourceMimeType,
			)) as DriveFile;
			const text = [
				`Successfully imported '${presName}' as Google Slides presentation`,
				`   Presentation ID: ${created.id ?? "N/A"}`,
				`   Source format: ${sourceMimeType}`,
				`   Folder: ${folder_id}`,
				`   Link: ${created.webViewLink ?? "N/A"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 9. import_to_google_sheets ─────────────────────────────────────────────
	server.tool(
		"import_to_google_sheets",
		"Import a spreadsheet (XLSX, XLS, ODS, CSV, TSV) into Google Sheets format with automatic conversion.",
		{
			file_name: z
				.string()
				.describe(
					"Name for the new Google Sheets spreadsheet (extension is ignored).",
				),
			content: z
				.string()
				.optional()
				.describe("Text content for text-based formats (CSV, TSV)."),
			file_url: z
				.string()
				.optional()
				.describe("HTTP/HTTPS URL to fetch the spreadsheet from."),
			source_format: z
				.string()
				.optional()
				.describe("Source format hint: xlsx, xls, ods, csv, tsv."),
			folder_id: z
				.string()
				.default("root")
				.describe("Parent folder ID (default 'root')."),
		},
		async ({ file_name, content, file_url, source_format, folder_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { bytes, sourceMimeType } = await resolveImportContent(
				"import_to_google_sheets",
				file_name,
				content,
				file_url,
				source_format,
				GOOGLE_SHEETS_IMPORT_FORMATS,
			);
			const sheetName = file_name.replace(/\.[^.]+$/, "") || file_name;
			const resolvedParent = await resolveFolderId(accessToken, folder_id);
			const metadata: Record<string, unknown> = {
				name: sheetName,
				parents: [resolvedParent],
				mimeType: GOOGLE_SHEETS_MIME,
			};
			const uploadUrl = buildUrl(`${DRIVE_UPLOAD}/files`, {
				uploadType: "multipart",
				fields: "id,name,webViewLink,mimeType",
				supportsAllDrives: true,
			});
			const created = (await driveMultipartUpload(
				accessToken,
				"POST",
				uploadUrl,
				metadata,
				bytes,
				sourceMimeType,
			)) as DriveFile;
			const text = [
				`Successfully imported '${sheetName}' as Google Sheets spreadsheet`,
				`   Spreadsheet ID: ${created.id ?? "N/A"}`,
				`   Source format: ${sourceMimeType}`,
				`   Folder: ${folder_id}`,
				`   Link: ${created.webViewLink ?? "N/A"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 10. get_drive_file_permissions ─────────────────────────────────────────
	server.tool(
		"get_drive_file_permissions",
		"Get detailed metadata and permissions for a Google Drive file.",
		{
			file_id: z.string().describe("Google Drive file ID."),
		},
		async ({ file_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { id: resolvedId } = await resolveFileId(accessToken, file_id);
			const url = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`,
				{
					fields:
						"id, name, mimeType, size, parents, createdTime, modifiedTime," +
						" trashed, driveId, owners(displayName,emailAddress)," +
						" permissions(id, type, role, emailAddress, domain, expirationTime, permissionDetails)," +
						" webViewLink, webContentLink, shared, sharingUser, viewersCanCopyContent",
					supportsAllDrives: true,
				},
			);
			const f = (await googleApiFetch(accessToken, url)) as DriveFile & {
				viewersCanCopyContent?: boolean;
			};

			const parents = f.parents;
			const parentStr = parents?.length
				? parents.join(", ")
				: "None (root or orphaned)";
			const owners = f.owners ?? [];
			const ownerStr = owners.length
				? owners
						.map((o) => {
							const name = o.displayName ?? "Unknown";
							const email = o.emailAddress;
							return email ? `${name} (${email})` : name;
						})
						.join(", ")
				: "None available";

			const permissions = f.permissions ?? [];
			const hasPublic = checkPublicLinkPermission(permissions);

			const parts = [
				`File: ${f.name ?? "Unknown"}`,
				`ID: ${resolvedId}`,
				`Type: ${f.mimeType ?? "Unknown"}`,
				`Parents: ${parentStr}`,
				`Owners: ${ownerStr}`,
				`Size: ${f.size ?? "N/A"} bytes`,
				`Created: ${f.createdTime ?? "N/A"}`,
				`Modified: ${f.modifiedTime ?? "N/A"}`,
				`Trashed: ${f.trashed ?? false}`,
			];
			if (f.driveId) parts.push(`Shared Drive ID: ${f.driveId}`);
			parts.push("", "Sharing Status:", `  Shared: ${f.shared ?? false}`);
			const su = f.sharingUser;
			if (su) {
				parts.push(
					`  Shared by: ${su.displayName ?? "Unknown"} (${su.emailAddress ?? "Unknown"})`,
				);
			}
			if (permissions.length > 0) {
				parts.push(`  Number of permissions: ${permissions.length}`);
				parts.push("  Permissions:");
				for (const p of permissions) {
					parts.push(`    - ${formatPermissionInfo(p)}`);
				}
			} else {
				parts.push("  No additional permissions (private file)");
			}
			parts.push("", "URLs:", `  View Link: ${f.webViewLink ?? "N/A"}`);
			if (f.webContentLink)
				parts.push(`  Direct Download Link: ${f.webContentLink}`);
			if (hasPublic) {
				parts.push(
					"",
					"This file is shared with 'Anyone with the link' - it can be inserted into Google Docs",
				);
			} else {
				parts.push(
					"",
					"This file is NOT shared with 'Anyone with the link' - it cannot be inserted into Google Docs",
					"  To fix: Right-click the file in Google Drive -> Share -> Anyone with the link -> Viewer",
				);
			}
			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
			};
		},
	);

	// ── 11. check_drive_file_public_access ─────────────────────────────────────
	server.tool(
		"check_drive_file_public_access",
		"Search for a file by name and check whether it has 'Anyone with the link' sharing enabled.",
		{
			file_name: z.string().describe("Name of the file to search for."),
			drive_id: z
				.string()
				.optional()
				.describe("Shared drive ID to scope the search."),
		},
		async ({ file_name, drive_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const escaped = file_name.replace(/'/g, "\\'");
			const listParams: Record<
				string,
				string | number | boolean | null | undefined
			> = {
				q: `name = '${escaped}'`,
				pageSize: 10,
				fields: "files(id, name, mimeType, webViewLink)",
				supportsAllDrives: true,
				includeItemsFromAllDrives: true,
			};
			if (drive_id) {
				listParams.corpora = "drive";
				listParams.driveId = drive_id;
			}
			const listUrl = buildUrl(`${DRIVE_BASE}/files`, listParams);
			const listData = (await googleApiFetch(
				accessToken,
				listUrl,
			)) as DriveFilesListResponse;
			const files = listData.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No file found with name '${file_name}'`,
						},
					],
				};
			}

			const outputParts: string[] = [];
			if (files.length > 1) {
				outputParts.push(
					`Found ${files.length} files with name '${file_name}':`,
				);
				for (const f of files) {
					outputParts.push(`  - ${f.name ?? "Unknown"} (ID: ${f.id ?? "N/A"})`);
				}
				outputParts.push("\nChecking the first file...", "");
			}

			const firstId = files[0].id ?? "";
			const { id: resolvedId } = await resolveFileId(accessToken, firstId);
			const detailUrl = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`,
				{
					fields:
						"id, name, mimeType, permissions, webViewLink, webContentLink, shared",
					supportsAllDrives: true,
				},
			);
			const f = (await googleApiFetch(accessToken, detailUrl)) as DriveFile;
			const permissions = f.permissions ?? [];
			const hasPublic = checkPublicLinkPermission(permissions);

			outputParts.push(
				`File: ${f.name ?? "Unknown"}`,
				`ID: ${resolvedId}`,
				`Type: ${f.mimeType ?? "Unknown"}`,
				`Shared: ${f.shared ?? false}`,
				"",
			);
			if (hasPublic) {
				outputParts.push(
					"PUBLIC ACCESS ENABLED - This file can be inserted into Google Docs",
					`Use with insert_doc_image_url: ${getDriveImageUrl(resolvedId)}`,
				);
			} else {
				outputParts.push(
					"NO PUBLIC ACCESS - Cannot insert into Google Docs",
					"Fix: Drive -> Share -> 'Anyone with the link' -> 'Viewer'",
				);
			}
			return {
				content: [{ type: "text" as const, text: outputParts.join("\n") }],
			};
		},
	);

	// ── 12. update_drive_file ─────────────────────────────────────────────────
	server.tool(
		"update_drive_file",
		"Update metadata and/or content of a Google Drive file. Providing content/file_url replaces the file's content in-place (only supported for native Google Docs/Sheets/Slides).",
		{
			file_id: z.string().describe("ID of the file to update."),
			name: z.string().optional().describe("New file name."),
			description: z.string().optional().describe("New file description."),
			mime_type: z
				.string()
				.optional()
				.describe("New MIME type (changing type may require content upload)."),
			add_parents: z
				.string()
				.optional()
				.describe("Comma-separated folder IDs to add as parents."),
			remove_parents: z
				.string()
				.optional()
				.describe("Comma-separated folder IDs to remove from parents."),
			starred: z.boolean().optional().describe("Star or unstar the file."),
			trashed: z
				.boolean()
				.optional()
				.describe("Move to trash (true) or restore (false)."),
			writers_can_share: z
				.boolean()
				.optional()
				.describe("Whether editors can share the file."),
			copy_requires_writer_permission: z
				.boolean()
				.optional()
				.describe("Whether copying requires writer permission."),
			properties: z
				.record(z.string(), z.string())
				.optional()
				.describe("Custom key-value properties."),
			content: z
				.string()
				.optional()
				.describe(
					"New text content (MD, TXT, HTML). Only for native Google Docs/Sheets/Slides.",
				),
			file_url: z
				.string()
				.optional()
				.describe(
					"HTTP/HTTPS URL to fetch new content from. Only for native Google Docs/Sheets/Slides.",
				),
			source_format: z
				.string()
				.optional()
				.describe(
					"Source format hint for content conversion (md, docx, txt, html, rtf, odt).",
				),
		},
		async ({
			file_id,
			name,
			description,
			mime_type,
			add_parents,
			remove_parents,
			starred,
			trashed,
			writers_can_share,
			copy_requires_writer_permission,
			properties,
			content,
			file_url,
			source_format,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");
			const extraFields =
				"name, description, mimeType, parents, starred, trashed, webViewLink, writersCanShare, copyRequiresWriterPermission, properties";
			const { id: resolvedId, meta: currentFile } = await resolveFileId(
				accessToken,
				file_id,
				extraFields,
			);

			// Build metadata update body
			const updateBody: Record<string, unknown> = {};
			if (name !== undefined) updateBody.name = name;
			if (description !== undefined) updateBody.description = description;
			if (mime_type !== undefined) updateBody.mimeType = mime_type;
			if (starred !== undefined) updateBody.starred = starred;
			if (trashed !== undefined) updateBody.trashed = trashed;
			if (writers_can_share !== undefined)
				updateBody.writersCanShare = writers_can_share;
			if (copy_requires_writer_permission !== undefined)
				updateBody.copyRequiresWriterPermission =
					copy_requires_writer_permission;
			if (properties !== undefined) updateBody.properties = properties;

			const replacingContent = content !== undefined || file_url !== undefined;
			const updateFields =
				"id, name, description, mimeType, parents, starred, trashed, webViewLink, writersCanShare, copyRequiresWriterPermission, properties";

			// Build base query params
			const queryParams: Record<string, string | boolean | null | undefined> = {
				supportsAllDrives: true,
				fields: updateFields,
				addParents: add_parents ?? undefined,
				removeParents: remove_parents ?? undefined,
			};

			let updated: DriveFile;

			if (replacingContent) {
				// Content update: only supported for native Google Apps files
				const targetMime = mime_type ?? currentFile.mimeType ?? "";
				const formatMap = IMPORT_FORMATS_BY_GOOGLE_MIME[targetMime];
				if (!formatMap) {
					const supported = Object.keys(IMPORT_FORMATS_BY_GOOGLE_MIME).join(
						", ",
					);
					throw new Error(
						`Content replacement is only supported for native Google Docs, Sheets, and Slides. ` +
							`Current MIME type: ${targetMime || "unknown"}. Supported: ${supported}`,
					);
				}
				const { bytes, sourceMimeType } = await resolveImportContent(
					"update_drive_file",
					name ?? currentFile.name ?? "",
					content,
					file_url,
					source_format,
					formatMap,
				);
				const uploadUrl = buildUrl(
					`${DRIVE_UPLOAD}/files/${encodeURIComponent(resolvedId)}`,
					{ uploadType: "multipart", ...queryParams },
				);
				updated = (await driveMultipartUpload(
					accessToken,
					"PATCH",
					uploadUrl,
					updateBody,
					bytes,
					sourceMimeType,
				)) as DriveFile;
			} else {
				// Metadata-only update
				const patchUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`,
					queryParams,
				);
				updated = (await googleApiFetch(accessToken, patchUrl, {
					method: "PATCH",
					body: JSON.stringify(updateBody),
				})) as DriveFile;
			}

			const outputParts = [
				`Successfully updated file: ${updated.name ?? currentFile.name ?? "Unknown"}`,
				`   File ID: ${resolvedId}`,
			];
			const changes: string[] = [];
			if (name !== undefined && name !== currentFile.name)
				changes.push(`   • Name: '${currentFile.name ?? "?"}' -> '${name}'`);
			if (description !== undefined) changes.push(`   • Description updated`);
			if (add_parents) changes.push(`   • Added to folder(s): ${add_parents}`);
			if (remove_parents)
				changes.push(`   • Removed from folder(s): ${remove_parents}`);
			if (starred !== undefined && starred !== currentFile.starred)
				changes.push(`   • File ${starred ? "starred" : "unstarred"}`);
			if (trashed !== undefined && trashed !== currentFile.trashed)
				changes.push(
					`   • File ${trashed ? "moved to trash" : "restored from trash"}`,
				);
			if (writers_can_share !== undefined)
				changes.push(
					`   • Writers ${writers_can_share ? "can" : "cannot"} share the file`,
				);
			if (copy_requires_writer_permission !== undefined)
				changes.push(
					`   • Copying ${copy_requires_writer_permission ? "requires" : "doesn't require"} writer permission`,
				);
			if (properties) changes.push(`   • Updated custom properties`);
			if (replacingContent) changes.push(`   • Replaced file content`);

			if (changes.length > 0) {
				outputParts.push("", "Changes applied:");
				outputParts.push(...changes);
			} else {
				outputParts.push("   (No changes were made)");
			}
			outputParts.push("", `View file: ${updated.webViewLink ?? "#"}`);
			return {
				content: [{ type: "text" as const, text: outputParts.join("\n") }],
			};
		},
	);

	// ── 13. get_drive_shareable_link ───────────────────────────────────────────
	server.tool(
		"get_drive_shareable_link",
		"Get the shareable links and current sharing status for a Google Drive file or folder.",
		{
			file_id: z.string().describe("ID of the file or folder."),
		},
		async ({ file_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { id: resolvedId } = await resolveFileId(accessToken, file_id);
			const url = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`,
				{
					fields:
						"id, name, mimeType, webViewLink, webContentLink, shared," +
						" permissions(id, type, role, emailAddress, domain, expirationTime)",
					supportsAllDrives: true,
				},
			);
			const f = (await googleApiFetch(accessToken, url)) as DriveFile;
			const parts = [
				`File: ${f.name ?? "Unknown"}`,
				`ID: ${resolvedId}`,
				`Type: ${f.mimeType ?? "Unknown"}`,
				`Shared: ${f.shared ?? false}`,
				"",
				"Links:",
				`  View: ${f.webViewLink ?? "N/A"}`,
			];
			if (f.webContentLink) parts.push(`  Download: ${f.webContentLink}`);
			const permissions = f.permissions ?? [];
			if (permissions.length > 0) {
				parts.push("", "Current permissions:");
				for (const p of permissions)
					parts.push(`  - ${formatPermissionInfo(p)}`);
			}
			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
			};
		},
	);

	// ── 14. manage_drive_access ────────────────────────────────────────────────
	server.tool(
		"manage_drive_access",
		"Grant, update, revoke, batch-grant, or transfer ownership of Google Drive file permissions.",
		{
			file_id: z.string().describe("ID of the file or folder."),
			action: z
				.string()
				.describe(
					"'grant', 'grant_batch', 'update', 'revoke', or 'transfer_owner'.",
				),
			share_with: z
				.string()
				.optional()
				.describe(
					"Email (user/group), domain name, or omit for 'anyone'. Used by 'grant'.",
				),
			role: z
				.string()
				.optional()
				.describe(
					"'reader', 'commenter', or 'writer'. Used by 'grant' (default 'reader') and 'update'.",
				),
			share_type: z
				.string()
				.default("user")
				.describe("'user', 'group', 'domain', or 'anyone'. Used by 'grant'."),
			permission_id: z
				.string()
				.optional()
				.describe("Permission ID. Required for 'update' and 'revoke'."),
			recipients: z
				.array(
					z.object({
						email: z.string().optional(),
						domain: z.string().optional(),
						role: z.string().optional(),
						share_type: z.string().optional(),
						expiration_time: z.string().optional(),
					}),
				)
				.optional()
				.describe(
					"List of recipients for 'grant_batch'. Each needs email/domain, role, share_type.",
				),
			send_notification: z
				.boolean()
				.default(true)
				.describe("Send notification emails (default true)."),
			email_message: z
				.string()
				.optional()
				.describe("Custom notification email message."),
			expiration_time: z
				.string()
				.optional()
				.describe(
					"Permission expiration in RFC 3339 format (e.g. '2025-01-15T00:00:00Z').",
				),
			allow_file_discovery: z
				.boolean()
				.optional()
				.describe(
					"For domain/anyone shares, whether the file appears in search.",
				),
			new_owner_email: z
				.string()
				.optional()
				.describe("New owner's email. Required for 'transfer_owner'."),
			move_to_new_owners_root: z
				.boolean()
				.default(false)
				.describe("Move file to new owner's My Drive root on transfer."),
		},
		async ({
			file_id,
			action,
			share_with,
			role,
			share_type,
			permission_id,
			recipients,
			send_notification,
			email_message,
			expiration_time,
			allow_file_discovery,
			new_owner_email,
			move_to_new_owners_root,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");
			const validActions = [
				"grant",
				"grant_batch",
				"update",
				"revoke",
				"transfer_owner",
			];
			if (!validActions.includes(action)) {
				throw new Error(
					`Invalid action '${action}'. Must be one of: ${validActions.join(", ")}`,
				);
			}

			if (action === "grant") {
				const effectiveRole = role ?? "reader";
				validateShareRole(effectiveRole);
				validateShareType(share_type);
				if ((share_type === "user" || share_type === "group") && !share_with) {
					throw new Error(
						`share_with is required for share_type '${share_type}'`,
					);
				}
				if (share_type === "domain" && !share_with) {
					throw new Error(
						"share_with (domain name) is required for share_type 'domain'",
					);
				}
				const { id: resolvedId, meta: fileMeta } = await resolveFileId(
					accessToken,
					file_id,
					"name,webViewLink",
				);
				const permBody: Record<string, unknown> = {
					type: share_type,
					role: effectiveRole,
				};
				if (share_type === "user" || share_type === "group") {
					permBody.emailAddress = share_with;
				} else if (share_type === "domain") {
					permBody.domain = share_with;
				}
				if (expiration_time) {
					validateExpirationTime(expiration_time);
					permBody.expirationTime = expiration_time;
				}
				if (
					(share_type === "domain" || share_type === "anyone") &&
					allow_file_discovery !== undefined
				) {
					permBody.allowFileDiscovery = allow_file_discovery;
				}
				const createParams: Record<
					string,
					string | boolean | null | undefined
				> = {
					supportsAllDrives: true,
					fields: "id, type, role, emailAddress, domain, expirationTime",
				};
				if (share_type === "user" || share_type === "group") {
					createParams.sendNotificationEmail = send_notification;
					if (email_message) createParams.emailMessage = email_message;
				}
				const permUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions`,
					createParams,
				);
				const created = (await googleApiFetch(accessToken, permUrl, {
					method: "POST",
					body: JSON.stringify(permBody),
				})) as DrivePermission;
				const text = [
					`Successfully shared '${fileMeta.name ?? "Unknown"}'`,
					"",
					"Permission created:",
					`  - ${formatPermissionInfo(created)}`,
					"",
					`View link: ${fileMeta.webViewLink ?? "N/A"}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			if (action === "grant_batch") {
				if (!recipients || recipients.length === 0) {
					throw new Error(
						"recipients list is required for 'grant_batch' action",
					);
				}
				const { id: resolvedId, meta: fileMeta } = await resolveFileId(
					accessToken,
					file_id,
					"name,webViewLink",
				);
				const results: string[] = [];
				let successCount = 0;
				let failureCount = 0;
				for (const recipient of recipients) {
					const rType = recipient.share_type ?? "user";
					const identifier =
						rType === "domain" ? recipient.domain : recipient.email;
					if (!identifier) {
						results.push(
							`  - Skipped: missing ${rType === "domain" ? "domain" : "email"} address`,
						);
						failureCount++;
						continue;
					}
					const rRole = recipient.role ?? "reader";
					try {
						validateShareRole(rRole);
						validateShareType(rType);
					} catch (err) {
						results.push(`  - ${identifier}: Failed - ${String(err)}`);
						failureCount++;
						continue;
					}
					const rPermBody: Record<string, unknown> = {
						type: rType,
						role: rRole,
					};
					if (rType === "domain") {
						rPermBody.domain = identifier;
					} else {
						rPermBody.emailAddress = identifier;
					}
					if (recipient.expiration_time) {
						try {
							validateExpirationTime(recipient.expiration_time);
							rPermBody.expirationTime = recipient.expiration_time;
						} catch (err) {
							results.push(`  - ${identifier}: Failed - ${String(err)}`);
							failureCount++;
							continue;
						}
					}
					const rParams: Record<string, string | boolean | null | undefined> = {
						supportsAllDrives: true,
						fields: "id, type, role, emailAddress, domain, expirationTime",
					};
					if (rType === "user" || rType === "group") {
						rParams.sendNotificationEmail = send_notification;
						if (email_message) rParams.emailMessage = email_message;
					}
					try {
						const rUrl = buildUrl(
							`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions`,
							rParams,
						);
						const created = (await googleApiFetch(accessToken, rUrl, {
							method: "POST",
							body: JSON.stringify(rPermBody),
						})) as DrivePermission;
						results.push(`  - ${formatPermissionInfo(created)}`);
						successCount++;
					} catch (err) {
						results.push(`  - ${identifier}: Failed - ${String(err)}`);
						failureCount++;
					}
				}
				const text = [
					`Batch share results for '${fileMeta.name ?? "Unknown"}'`,
					"",
					`Summary: ${successCount} succeeded, ${failureCount} failed`,
					"",
					"Results:",
					...results,
					"",
					`View link: ${fileMeta.webViewLink ?? "N/A"}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			if (action === "update") {
				if (!permission_id)
					throw new Error("permission_id is required for 'update' action");
				if (!role && !expiration_time)
					throw new Error(
						"Must provide at least one of: role, expiration_time for 'update' action",
					);
				if (role) validateShareRole(role);
				if (expiration_time) validateExpirationTime(expiration_time);
				const { id: resolvedId, meta: fileMeta } = await resolveFileId(
					accessToken,
					file_id,
					"name",
				);
				let effectiveRole = role;
				if (!effectiveRole) {
					const currentUrl = buildUrl(
						`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions/${encodeURIComponent(permission_id)}`,
						{ supportsAllDrives: true, fields: "role" },
					);
					const current = (await googleApiFetch(
						accessToken,
						currentUrl,
					)) as DrivePermission;
					effectiveRole = current.role;
				}
				const updateBody: Record<string, unknown> = {
					role: effectiveRole,
				};
				if (expiration_time) updateBody.expirationTime = expiration_time;
				const patchUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions/${encodeURIComponent(permission_id)}`,
					{
						supportsAllDrives: true,
						fields: "id, type, role, emailAddress, domain, expirationTime",
					},
				);
				const updated = (await googleApiFetch(accessToken, patchUrl, {
					method: "PATCH",
					body: JSON.stringify(updateBody),
				})) as DrivePermission;
				const text = [
					`Successfully updated permission on '${fileMeta.name ?? "Unknown"}'`,
					"",
					"Updated permission:",
					`  - ${formatPermissionInfo(updated)}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			if (action === "revoke") {
				if (!permission_id)
					throw new Error("permission_id is required for 'revoke' action");
				const { id: resolvedId, meta: fileMeta } = await resolveFileId(
					accessToken,
					file_id,
					"name",
				);
				const deleteUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions/${encodeURIComponent(permission_id)}`,
					{ supportsAllDrives: true },
				);
				await googleApiFetch(accessToken, deleteUrl, { method: "DELETE" });
				const text = [
					`Successfully removed permission from '${fileMeta.name ?? "Unknown"}'`,
					"",
					`Permission ID '${permission_id}' has been revoked.`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			// action === "transfer_owner"
			if (!new_owner_email)
				throw new Error(
					"new_owner_email is required for 'transfer_owner' action",
				);
			const { id: resolvedId, meta: fileMeta } = await resolveFileId(
				accessToken,
				file_id,
				"name,owners",
			);
			const currentOwners = fileMeta.owners ?? [];
			const currentOwnerEmails = currentOwners
				.map((o) => o.emailAddress ?? "")
				.filter(Boolean);
			const transferBody = {
				type: "user",
				role: "owner",
				emailAddress: new_owner_email,
			};
			const transferParams: Record<
				string,
				string | boolean | null | undefined
			> = {
				transferOwnership: true,
				moveToNewOwnersRoot: move_to_new_owners_root,
				supportsAllDrives: true,
				fields: "id, type, role, emailAddress",
			};
			const transferUrl = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions`,
				transferParams,
			);
			await googleApiFetch(accessToken, transferUrl, {
				method: "POST",
				body: JSON.stringify(transferBody),
			});
			const outputParts = [
				`Successfully transferred ownership of '${fileMeta.name ?? "Unknown"}'`,
				"",
				`New owner: ${new_owner_email}`,
				`Previous owner(s): ${currentOwnerEmails.join(", ") || "Unknown"}`,
			];
			if (move_to_new_owners_root)
				outputParts.push(`File moved to ${new_owner_email}'s My Drive root.`);
			outputParts.push("", "Note: Previous owner now has editor access.");
			return {
				content: [{ type: "text" as const, text: outputParts.join("\n") }],
			};
		},
	);

	// ── 15. copy_drive_file ────────────────────────────────────────────────────
	server.tool(
		"copy_drive_file",
		"Create a copy of an existing Google Drive file.",
		{
			file_id: z.string().describe("ID of the file to copy."),
			new_name: z
				.string()
				.optional()
				.describe("Name for the copy. Defaults to 'Copy of [original name]'."),
			parent_folder_id: z
				.string()
				.default("root")
				.describe("Destination folder ID (default 'root')."),
		},
		async ({ file_id, new_name, parent_folder_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const { id: resolvedId, meta: fileMeta } = await resolveFileId(
				accessToken,
				file_id,
				"name,webViewLink,mimeType",
			);
			const originalName = fileMeta.name ?? "Unknown File";
			const resolvedFolder = await resolveFolderId(
				accessToken,
				parent_folder_id,
			);
			const copyBody: Record<string, unknown> = {
				name: new_name ?? `Copy of ${originalName}`,
			};
			if (resolvedFolder !== "root") {
				copyBody.parents = [resolvedFolder];
			}
			const copyUrl = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/copy`,
				{
					supportsAllDrives: true,
					fields: "id, name, webViewLink, mimeType, parents",
				},
			);
			const copied = (await googleApiFetch(accessToken, copyUrl, {
				method: "POST",
				body: JSON.stringify(copyBody),
			})) as DriveFile;
			const text = [
				`Successfully copied '${originalName}'`,
				"",
				`Original file ID: ${resolvedId}`,
				`New file ID: ${copied.id ?? "N/A"}`,
				`New file name: ${copied.name ?? "Unknown"}`,
				`File type: ${copied.mimeType ?? "Unknown"}`,
				`Location: ${parent_folder_id}`,
				"",
				`View copied file: ${copied.webViewLink ?? "N/A"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 16. set_drive_file_permissions ─────────────────────────────────────────
	server.tool(
		"set_drive_file_permissions",
		"Set link-sharing mode and/or file-level sharing restrictions for a Google Drive file or folder.",
		{
			file_id: z.string().describe("ID of the file or folder."),
			link_sharing: z
				.string()
				.optional()
				.describe(
					"'off' (disable public link), 'reader', 'commenter', or 'writer' (anyone with the link).",
				),
			writers_can_share: z
				.boolean()
				.optional()
				.describe("Whether editors can change permissions."),
			copy_requires_writer_permission: z
				.boolean()
				.optional()
				.describe(
					"Whether viewers and commenters are prevented from copying/printing/downloading.",
				),
		},
		async ({
			file_id,
			link_sharing,
			writers_can_share,
			copy_requires_writer_permission,
		}) => {
			const { accessToken } = await ctx.getService("gdrive");
			if (
				link_sharing === undefined &&
				writers_can_share === undefined &&
				copy_requires_writer_permission === undefined
			) {
				throw new Error(
					"Must provide at least one of: link_sharing, writers_can_share, copy_requires_writer_permission",
				);
			}
			const validLinkSharing = new Set([
				"off",
				"reader",
				"commenter",
				"writer",
			]);
			if (link_sharing !== undefined && !validLinkSharing.has(link_sharing)) {
				throw new Error(
					`Invalid link_sharing '${link_sharing}'. Must be one of: ${[...validLinkSharing].sort().join(", ")}`,
				);
			}
			const { id: resolvedId, meta: fileMeta } = await resolveFileId(
				accessToken,
				file_id,
				"name,webViewLink",
			);
			const fileName = fileMeta.name ?? "Unknown";
			const changesMade: string[] = [];

			// File-level settings via files.update
			const fileUpdateBody: Record<string, unknown> = {};
			if (writers_can_share !== undefined)
				fileUpdateBody.writersCanShare = writers_can_share;
			if (copy_requires_writer_permission !== undefined)
				fileUpdateBody.copyRequiresWriterPermission =
					copy_requires_writer_permission;
			if (Object.keys(fileUpdateBody).length > 0) {
				const fileUpdateUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}`,
					{ supportsAllDrives: true, fields: "id" },
				);
				await googleApiFetch(accessToken, fileUpdateUrl, {
					method: "PATCH",
					body: JSON.stringify(fileUpdateBody),
				});
				if (writers_can_share !== undefined) {
					changesMade.push(
						`  - Editors sharing: ${writers_can_share ? "allowed" : "restricted to owner"}`,
					);
				}
				if (copy_requires_writer_permission !== undefined) {
					changesMade.push(
						`  - Viewers copy/print/download: ${copy_requires_writer_permission ? "restricted" : "allowed"}`,
					);
				}
			}

			// Link sharing via permissions API
			if (link_sharing !== undefined) {
				const listUrl = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions`,
					{
						supportsAllDrives: true,
						fields: "permissions(id, type, role)",
					},
				);
				const listData = (await googleApiFetch(
					accessToken,
					listUrl,
				)) as DrivePermissionsListResponse;
				const anyonePerms = (listData.permissions ?? []).filter(
					(p) => p.type === "anyone",
				);

				if (link_sharing === "off") {
					if (anyonePerms.length > 0) {
						for (const perm of anyonePerms) {
							if (!perm.id) continue;
							const delUrl = buildUrl(
								`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions/${encodeURIComponent(perm.id)}`,
								{ supportsAllDrives: true },
							);
							await googleApiFetch(accessToken, delUrl, {
								method: "DELETE",
							});
						}
						changesMade.push(
							"  - Link sharing: disabled (restricted to specific people)",
						);
					} else {
						changesMade.push("  - Link sharing: already off (no change)");
					}
				} else {
					const newRole = link_sharing;
					if (anyonePerms.length > 0 && anyonePerms[0].id) {
						const patchUrl = buildUrl(
							`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions/${encodeURIComponent(anyonePerms[0].id)}`,
							{
								supportsAllDrives: true,
								fields: "id, type, role",
							},
						);
						await googleApiFetch(accessToken, patchUrl, {
							method: "PATCH",
							body: JSON.stringify({
								role: newRole,
								allowFileDiscovery: false,
							}),
						});
						changesMade.push(`  - Link sharing: updated to '${newRole}'`);
					} else {
						const createUrl = buildUrl(
							`${DRIVE_BASE}/files/${encodeURIComponent(resolvedId)}/permissions`,
							{ supportsAllDrives: true, fields: "id, type, role" },
						);
						await googleApiFetch(accessToken, createUrl, {
							method: "POST",
							body: JSON.stringify({
								type: "anyone",
								role: newRole,
								allowFileDiscovery: false,
							}),
						});
						changesMade.push(`  - Link sharing: enabled as '${newRole}'`);
					}
				}
			}

			const outputParts = [
				`Permission settings updated for '${fileName}'`,
				"",
				"Changes:",
				...(changesMade.length > 0
					? changesMade
					: ["  - No changes (already configured)"]),
				"",
				`View link: ${fileMeta.webViewLink ?? "N/A"}`,
			];
			return {
				content: [{ type: "text" as const, text: outputParts.join("\n") }],
			};
		},
	);
}
