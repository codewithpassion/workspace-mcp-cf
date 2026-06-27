// Google Gmail tools — 14 tools for the `gmail` service.
//
// Module pattern (same for all service modules):
//   export function register(server: McpServer, ctx: ToolContext): void
//
// Runtime notes:
//   - Gmail Batch HTTP API is not available; batch tools use sequential fetching.
//   - Local file storage is not available; attachment content is returned as base64.
//   - MIME messages for send/draft are hand-built (no Python email.message).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URL ─────────────────────────────────────────────────────────────

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

// ─── Constants ────────────────────────────────────────────────────────────────

const GMAIL_METADATA_HEADERS = [
	"Subject",
	"From",
	"To",
	"Cc",
	"Message-ID",
	"In-Reply-To",
	"References",
	"Date",
	"List-Unsubscribe",
	"Precedence",
	"List-Id",
];

const HTML_BODY_TRUNCATE_LIMIT = 20_000;
const RAW_BODY_TRUNCATE_LIMIT = 20_000;

// ─── Authenticated fetch alias ────────────────────────────────────────────────

const gmFetch = googleApiFetch;

// ─── URL builder ─────────────────────────────────────────────────────────────

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

/** Build a metadata-format Gmail message URL with repeated metadataHeaders params. */
function buildMetadataUrl(base: string): string {
	const url = new URL(base);
	url.searchParams.set("format", "metadata");
	for (const h of GMAIL_METADATA_HEADERS) {
		url.searchParams.append("metadataHeaders", h);
	}
	return url.toString();
}

/**
 * Build a thread metadata URL with a custom set of metadataHeaders.
 * Uses repeated params (not comma-joined) since Gmail doesn't split on commas.
 */
function buildThreadMetadataUrl(threadId: string, headers: string[]): string {
	const url = new URL(
		`${GMAIL_BASE}/users/me/threads/${encodeURIComponent(threadId)}`,
	);
	url.searchParams.set("format", "metadata");
	for (const h of headers) {
		url.searchParams.append("metadataHeaders", h);
	}
	return url.toString();
}

// ─── Response type interfaces ─────────────────────────────────────────────────

interface GmailHeader {
	name: string;
	value: string;
}

interface GmailBodyPart {
	data?: string;
	size?: number;
	attachmentId?: string;
}

interface GmailPart {
	mimeType?: string;
	headers?: GmailHeader[];
	body?: GmailBodyPart;
	parts?: GmailPart[];
	filename?: string;
}

interface GmailMessage {
	id?: string;
	threadId?: string;
	payload?: GmailPart;
	raw?: string;
	labelIds?: string[];
	internalDate?: string;
}

interface GmailThread {
	id?: string;
	messages?: GmailMessage[];
}

interface GmailLabel {
	id?: string;
	name?: string;
	type?: string;
}

interface GmailFilterObj {
	id?: string;
	criteria?: Record<string, unknown>;
	action?: Record<string, unknown>;
}

interface SendAsEntry {
	sendAsEmail?: string;
	isPrimary?: boolean;
	signature?: string;
}

interface AttachmentInfo {
	filename: string;
	mimeType: string;
	size: number;
	attachmentId: string;
}

// ─── Base64 helpers ───────────────────────────────────────────────────────────

/** Decode Gmail's URL-safe, unpadded base64 to a UTF-8 string. */
function decodeBase64Url(data: string): string {
	if (!data) return "";
	const standard =
		data.replace(/-/g, "+").replace(/_/g, "/") +
		"===".slice((data.length + 3) % 4);
	try {
		const binaryStr = atob(standard);
		const bytes = new Uint8Array(binaryStr.length);
		for (let i = 0; i < binaryStr.length; i++) {
			bytes[i] = binaryStr.charCodeAt(i);
		}
		return new TextDecoder("utf-8").decode(bytes);
	} catch {
		return "";
	}
}

/** Convert URL-safe base64 to standard (padded) base64. */
function urlSafeToStdBase64(urlSafe: string): string {
	return (
		urlSafe.replace(/-/g, "+").replace(/_/g, "/") +
		"===".slice((urlSafe.length + 3) % 4)
	);
}

/** Encode a UTF-8 string to standard base64 (no URL-safe substitution). */
function textToBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

/** Wrap base64 at 76 chars per line (RFC 2045). */
function wrapBase64(b64: string): string {
	const lines: string[] = [];
	for (let i = 0; i < b64.length; i += 76) {
		lines.push(b64.slice(i, i + 76));
	}
	return lines.join("\r\n");
}

/** Encode a raw MIME string to URL-safe base64 for Gmail API `raw` field. */
function mimeToUrlSafeBase64(mimeStr: string): string {
	const bytes = new TextEncoder().encode(mimeStr);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
}

// ─── HTML → plain text ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
	return html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<\/li>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

// ─── Payload parsing helpers ──────────────────────────────────────────────────

function extractHeaders(
	payload: GmailPart,
	names: string[],
): Record<string, string> {
	const result: Record<string, string> = {};
	const lookup = new Map(names.map((n) => [n.toLowerCase(), n]));
	for (const h of payload.headers ?? []) {
		const key = lookup.get(h.name.toLowerCase());
		if (key) result[key] = h.value;
	}
	return result;
}

function extractMessageBodies(payload: GmailPart): {
	text: string;
	html: string;
} {
	let textBody = "";
	let htmlBody = "";
	const queue: GmailPart[] = [payload];
	while (queue.length > 0) {
		const part = queue.shift();
		if (!part) break;
		const mime = part.mimeType ?? "";
		const data = part.body?.data;
		if (data) {
			const decoded = decodeBase64Url(data);
			if (mime === "text/plain" && !textBody) textBody = decoded;
			else if (mime === "text/html" && !htmlBody) htmlBody = decoded;
		}
		if (mime.startsWith("multipart/") && part.parts) {
			queue.push(...part.parts);
		}
	}
	return { text: textBody, html: htmlBody };
}

function extractAttachments(payload: GmailPart): AttachmentInfo[] {
	const result: AttachmentInfo[] = [];
	function walk(part: GmailPart): void {
		if (part.filename && part.body?.attachmentId) {
			result.push({
				filename: part.filename,
				mimeType: part.mimeType ?? "application/octet-stream",
				size: part.body.size ?? 0,
				attachmentId: part.body.attachmentId,
			});
		}
		for (const sub of part.parts ?? []) walk(sub);
	}
	walk(payload);
	return result;
}

function formatBodyContent(
	text: string,
	html: string,
	bodyFormat: "text" | "html",
): string {
	if (bodyFormat === "html") {
		const s = html.trim();
		if (s)
			return s.length > HTML_BODY_TRUNCATE_LIMIT
				? s.slice(0, HTML_BODY_TRUNCATE_LIMIT) + "\n\n[Content truncated...]"
				: s;
		return text.trim() || "[No readable content found]";
	}
	const textS = text.trim();
	const htmlS = html.trim();
	const htmlText = htmlS ? htmlToText(htmlS) : "";
	const LOW_VALUE = [
		"your client does not support html",
		"view this email in your browser",
		"open this email in your browser",
	];
	const isLowValue = LOW_VALUE.some((m) => textS.toLowerCase().includes(m));
	const useHtml = htmlText && (!textS || textS.includes("<!--") || isLowValue);
	if (useHtml)
		return htmlText.length > HTML_BODY_TRUNCATE_LIMIT
			? htmlText.slice(0, HTML_BODY_TRUNCATE_LIMIT) +
					"\n\n[Content truncated...]"
			: htmlText;
	return textS || "[No readable content found]";
}

function formatMessageHeaderLines(
	headers: Record<string, string>,
	messageId?: string,
): string[] {
	const lines: string[] = [];
	if (messageId) lines.push(`Message ID: ${messageId}`);
	lines.push(
		`Subject: ${headers["Subject"] ?? "(no subject)"}`,
		`From: ${headers["From"] ?? "(unknown sender)"}`,
		`Date: ${headers["Date"] ?? "(unknown date)"}`,
	);
	if (headers["Message-ID"]) lines.push(`Message-ID: ${headers["Message-ID"]}`);
	if (headers["In-Reply-To"])
		lines.push(`In-Reply-To: ${headers["In-Reply-To"]}`);
	if (headers["References"]) lines.push(`References: ${headers["References"]}`);
	if (headers["To"]) lines.push(`To: ${headers["To"]}`);
	if (headers["Cc"]) lines.push(`Cc: ${headers["Cc"]}`);
	if (headers["List-Unsubscribe"])
		lines.push(`List-Unsubscribe: ${headers["List-Unsubscribe"]}`);
	if (headers["Precedence"]) lines.push(`Precedence: ${headers["Precedence"]}`);
	if (headers["List-Id"]) lines.push(`List-Id: ${headers["List-Id"]}`);
	return lines;
}

function generateGmailWebUrl(itemId: string, accountIndex = 0): string {
	return `https://mail.google.com/mail/u/${accountIndex}/#all/${itemId}`;
}

// ─── Thread content formatter ─────────────────────────────────────────────────

function formatThreadContent(
	thread: GmailThread,
	threadId: string,
	bodyFormat: "text" | "html" | "raw",
	rawContents?: Record<string, string>,
): string {
	const messages = thread.messages ?? [];
	if (messages.length === 0)
		return `No messages found in thread '${threadId}'.`;

	const firstHdrs: Record<string, string> = {};
	for (const h of messages[0].payload?.headers ?? []) {
		firstHdrs[h.name] = h.value;
	}
	const threadSubject = firstHdrs["Subject"] ?? "(no subject)";

	const lines: string[] = [
		`Thread ID: ${threadId}`,
		`Subject: ${threadSubject}`,
		`Messages: ${messages.length}`,
		"",
	];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const payload = msg.payload ?? {};
		const hMap: Record<string, string> = {};
		for (const h of payload.headers ?? []) hMap[h.name] = h.value;

		const mid = msg.id ?? "";
		let bodyData: string;
		let bodyLabel: string;

		if (bodyFormat === "raw") {
			bodyData = rawContents?.[mid] ?? "[No raw content found]";
			bodyLabel = "RAW MIME";
		} else {
			const bodies = extractMessageBodies(payload);
			bodyData = formatBodyContent(bodies.text, bodies.html, bodyFormat);
			bodyLabel = "BODY";
		}

		const atts = extractAttachments(payload);

		lines.push(`=== Message ${i + 1} ===`);
		lines.push(`From: ${hMap["From"] ?? "(unknown)"}`);
		lines.push(`Date: ${hMap["Date"] ?? "(unknown)"}`);
		if (hMap["Message-ID"]) lines.push(`Message-ID: ${hMap["Message-ID"]}`);
		if (hMap["In-Reply-To"]) lines.push(`In-Reply-To: ${hMap["In-Reply-To"]}`);
		if (hMap["References"]) lines.push(`References: ${hMap["References"]}`);
		if (hMap["Subject"] && hMap["Subject"] !== threadSubject)
			lines.push(`Subject: ${hMap["Subject"]}`);

		if (bodyFormat === "raw") {
			lines.push("", `--- ${bodyLabel} ---`, bodyData, "");
		} else {
			lines.push("", bodyData, "");
		}

		if (atts.length > 0) {
			lines.push("--- ATTACHMENTS ---");
			for (let j = 0; j < atts.length; j++) {
				const att = atts[j];
				const sizeKb = att.size / 1024;
				lines.push(
					`${j + 1}. ${att.filename} (${att.mimeType}, ${sizeKb.toFixed(1)} KB)`,
					`   Attachment ID: ${att.attachmentId}`,
					`   Use get_gmail_attachment_content(message_id='${mid}', attachment_id='${att.attachmentId}') to download`,
				);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

// ─── Thread ownership analysis ────────────────────────────────────────────────

function normalizeEmailAddr(addr: string): string {
	const angle = addr.match(/<([^>]+)>/);
	const email = (angle ? angle[1] : addr).trim().toLowerCase();
	if (!email.includes("@")) return email;
	const at = email.lastIndexOf("@");
	const local = email.slice(0, at).split("+")[0];
	const domain = email.slice(at + 1);
	return `${local}@${domain}`;
}

function extractEmailAddrs(header: string): string[] {
	if (!header) return [];
	const results: string[] = [];
	const re = /<([^>]+)>/g;
	let m = re.exec(header);
	while (m !== null) {
		results.push(m[1].trim());
		m = re.exec(header);
	}
	if (results.length === 0) {
		for (const part of header.split(",")) {
			const bare = part.trim().match(/\S+@\S+/);
			if (bare) results.push(bare[0]);
		}
	}
	return results;
}

function analyzeThreadOwnership(
	thread: GmailThread,
	accountEmail: string,
): Record<string, unknown> {
	const messages = thread.messages ?? [];
	const threadId = thread.id ?? "";

	if (messages.length === 0) {
		return {
			thread_id: threadId,
			thread_subject: null,
			last_sender: null,
			last_timestamp: null,
			ball_in_court_of: null,
			message_count_by_sender: {},
			participants: [],
			excluded_drafts: 0,
			message_count: 0,
		};
	}

	const normUser = normalizeEmailAddr(accountEmail);
	const firstHdrs: Record<string, string> = {};
	for (const h of messages[0].payload?.headers ?? [])
		firstHdrs[h.name] = h.value;
	const threadSubject: string | null = firstHdrs["Subject"] ?? null;

	const senderCounts: Record<string, number> = {};
	const allParticipants = new Set<string>();
	const nonDraftParticipants = new Set<string>();
	let excludedDrafts = 0;

	interface LastNonDraft {
		ts: number;
		headers: Record<string, string>;
	}
	let lastNonDraft: LastNonDraft | null = null;

	for (const msg of messages) {
		const labels = msg.labelIds ?? [];
		const isDraft = labels.includes("DRAFT");
		const hMap: Record<string, string> = {};
		for (const h of msg.payload?.headers ?? []) hMap[h.name] = h.value;

		const msgParts = new Set<string>();
		for (const hdrName of ["From", "To", "Cc"]) {
			for (const addr of extractEmailAddrs(hMap[hdrName] ?? "")) {
				const norm = normalizeEmailAddr(addr);
				if (norm.includes("@")) {
					allParticipants.add(norm);
					msgParts.add(norm);
				}
			}
		}

		if (isDraft) {
			excludedDrafts++;
			continue;
		}

		for (const p of msgParts) nonDraftParticipants.add(p);

		const fromNorm = hMap["From"] ? normalizeEmailAddr(hMap["From"]) : "";
		if (fromNorm.includes("@")) {
			senderCounts[fromNorm] = (senderCounts[fromNorm] ?? 0) + 1;
		}

		let ts = msg.internalDate ? parseInt(msg.internalDate, 10) || 0 : 0;
		if (ts === 0 && hMap["Date"]) ts = new Date(hMap["Date"]).getTime() || 0;

		if (lastNonDraft === null || ts >= lastNonDraft.ts) {
			lastNonDraft = { ts, headers: hMap };
		}
	}

	if (lastNonDraft === null) {
		return {
			thread_id: threadId,
			thread_subject: threadSubject,
			last_sender: null,
			last_timestamp: null,
			ball_in_court_of: null,
			message_count_by_sender: senderCounts,
			participants: [...allParticipants].sort(),
			excluded_drafts: excludedDrafts,
			message_count: messages.length,
		};
	}

	const lastSenderRaw = lastNonDraft.headers["From"] ?? "";
	const lastSenderNorm = lastSenderRaw ? normalizeEmailAddr(lastSenderRaw) : "";
	const lastTimestamp =
		lastNonDraft.ts > 0 ? new Date(lastNonDraft.ts).toISOString() : null;

	const external = new Set(
		[...nonDraftParticipants].filter((p) => p !== normUser),
	);

	let ballInCourtOf: string | null = null;
	if (
		normUser.includes("@") &&
		lastSenderNorm.includes("@") &&
		external.size > 0
	) {
		ballInCourtOf = lastSenderNorm === normUser ? "them" : "user";
	}

	return {
		thread_id: threadId,
		thread_subject: threadSubject,
		last_sender: lastSenderRaw || null,
		last_timestamp: lastTimestamp,
		ball_in_court_of: ballInCourtOf,
		message_count_by_sender: senderCounts,
		participants: [...allParticipants].sort(),
		excluded_drafts: excludedDrafts,
		message_count: messages.length,
	};
}

// ─── Forward content builder ──────────────────────────────────────────────────

function buildForwardContent(params: {
	headers: Record<string, string>;
	bodies: { text: string; html: string };
	forwardNote: string | null;
	noteFormat: "plain" | "html";
	subjectOverride: string | null;
}): { subject: string; body: string; bodyFormat: "plain" | "html" } {
	const { headers, bodies, forwardNote, noteFormat, subjectOverride } = params;
	const origSubject = headers["Subject"] ?? "(no subject)";
	const origFrom = headers["From"] ?? "(unknown sender)";
	const origDate = headers["Date"] ?? "(unknown date)";
	const origTo = headers["To"] ?? "";
	const hasHtml = bodies.html.trim().length > 0;

	const esc = (s: string) =>
		s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	const fwdTxt =
		"---------- Forwarded message ---------\n" +
		`From: ${origFrom}\nDate: ${origDate}\nSubject: ${origSubject}\nTo: ${origTo}`;
	const fwdHtml =
		'<div style="color:#777">---------- Forwarded message ---------<br/>' +
		`From: ${esc(origFrom)}<br/>Date: ${esc(origDate)}<br/>` +
		`Subject: ${esc(origSubject)}<br/>To: ${esc(origTo)}</div>`;

	let body: string;
	let bodyFormat: "plain" | "html";

	if (hasHtml || (forwardNote && noteFormat === "html")) {
		let noteHtml = "";
		if (forwardNote) {
			noteHtml =
				noteFormat === "html"
					? `<div>${forwardNote}</div><br/>`
					: `<div>${esc(forwardNote).replace(/\n/g, "<br/>")}</div><br/>`;
		}
		const origBodyHtml = hasHtml
			? bodies.html
			: esc(bodies.text).replace(/\n/g, "<br/>");
		body =
			noteHtml +
			'<div style="border-left:1px solid #ccc;padding-left:10px;margin-left:10px">' +
			fwdHtml +
			"<br/>" +
			origBodyHtml +
			"</div>";
		bodyFormat = "html";
	} else {
		const note = forwardNote ? `${forwardNote}\n\n` : "";
		body = `${note}${fwdTxt}\n\n${bodies.text}`;
		bodyFormat = "plain";
	}

	let subject = subjectOverride ?? origSubject;
	if (
		!subjectOverride &&
		!subject.toLowerCase().trimStart().startsWith("fwd:") &&
		!subject.toLowerCase().trimStart().startsWith("fw:")
	) {
		subject = `Fwd: ${origSubject}`;
	}
	return { subject, body, bodyFormat };
}

// ─── Gmail signature fetch ────────────────────────────────────────────────────

async function fetchSignatureHtml(
	accessToken: string,
	fromEmail?: string,
): Promise<string> {
	try {
		const data = (await gmFetch(
			accessToken,
			`${GMAIL_BASE}/users/me/settings/sendAs`,
		)) as { sendAs?: SendAsEntry[] };
		const entries = data.sendAs ?? [];
		if (fromEmail) {
			const norm = fromEmail.trim().toLowerCase();
			for (const e of entries) {
				if ((e.sendAsEmail ?? "").trim().toLowerCase() === norm)
					return e.signature ?? "";
			}
		}
		for (const e of entries) {
			if (e.isPrimary) return e.signature ?? "";
		}
		return entries[0]?.signature ?? "";
	} catch {
		return ""; // Benign failure (missing scope, etc.)
	}
}

function appendSignature(
	body: string,
	bodyFormat: "plain" | "html",
	sigHtml: string,
): string {
	if (!sigHtml?.trim()) return body;
	if (bodyFormat === "html") {
		const sep = body.trim() ? "<br><br>" : "";
		return `${body}${sep}${sigHtml}`;
	}
	const sigText = htmlToText(sigHtml).trim();
	if (!sigText) return body;
	const sep = body.trim() ? "\n\n" : "";
	return `${body}${sep}${sigText}`;
}

// ─── MIME builder (Workers-compatible) ───────────────────────────────────────

interface MimeAttachment {
	filename: string;
	mimeType: string;
	/** Standard (non-URL-safe) base64 content. */
	content: string;
}

function genBoundary(tag = "bnd"): string {
	return `${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** RFC2047 Base64-encode a header value if it contains non-ASCII characters. */
function encodeHeaderWord(val: string): string {
	// Detect non-ASCII by charCode comparison (avoids control chars in regex)
	if (!val.split("").some((c) => c.charCodeAt(0) >= 0x80)) return val;
	const bytes = new TextEncoder().encode(val);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return `=?UTF-8?B?${btoa(bin)}?=`;
}

/**
 * Build a raw MIME message string suitable for Gmail's `raw` field.
 * Supports plain text, HTML (with text/plain fallback), and file attachments.
 */
function buildRawMime(opts: {
	to?: string;
	from?: string;
	cc?: string;
	bcc?: string;
	subject: string;
	inReplyTo?: string;
	references?: string;
	body: string;
	bodyFormat: "plain" | "html";
	attachments?: MimeAttachment[];
}): string {
	const CRLF = "\r\n";
	const commonHdrs = [
		"MIME-Version: 1.0",
		opts.from ? `From: ${opts.from}` : "",
		opts.to ? `To: ${opts.to}` : "",
		opts.cc ? `Cc: ${opts.cc}` : "",
		opts.bcc ? `Bcc: ${opts.bcc}` : "",
		`Subject: ${encodeHeaderWord(opts.subject)}`,
		opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
		opts.references ? `References: ${opts.references}` : "",
	].filter(Boolean);

	const hasAtts = (opts.attachments?.length ?? 0) > 0;
	const isHtml = opts.bodyFormat === "html";

	// Build the body section
	let bodySection: string;
	if (isHtml) {
		const plain = htmlToText(opts.body);
		const altBnd = genBoundary("alt");
		bodySection =
			`Content-Type: multipart/alternative; boundary="${altBnd}"${CRLF}${CRLF}` +
			`--${altBnd}${CRLF}Content-Type: text/plain; charset="utf-8"${CRLF}` +
			`Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
			wrapBase64(textToBase64(plain)) +
			`${CRLF}${CRLF}--${altBnd}${CRLF}Content-Type: text/html; charset="utf-8"${CRLF}` +
			`Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
			wrapBase64(textToBase64(opts.body)) +
			`${CRLF}${CRLF}--${altBnd}--`;
	} else {
		bodySection =
			`Content-Type: text/plain; charset="utf-8"${CRLF}` +
			`Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
			wrapBase64(textToBase64(opts.body));
	}

	if (!hasAtts) {
		return commonHdrs.join(CRLF) + CRLF + bodySection;
	}

	// Wrap in multipart/mixed for attachments
	const mixBnd = genBoundary("mix");
	const hdrs = [
		...commonHdrs,
		`Content-Type: multipart/mixed; boundary="${mixBnd}"`,
	];
	let mime = hdrs.join(CRLF) + CRLF + CRLF;
	mime += `--${mixBnd}${CRLF}${bodySection}${CRLF}${CRLF}`;

	for (const att of opts.attachments ?? []) {
		const safe = att.filename
			.replace(/[\r\n]/g, "")
			.split("\x00")
			.join("");
		const b64 = att.content.replace(/\s/g, "");
		mime +=
			`--${mixBnd}${CRLF}` +
			`Content-Type: ${att.mimeType}; name="${safe}"${CRLF}` +
			`Content-Transfer-Encoding: base64${CRLF}` +
			`Content-Disposition: attachment; filename="${safe}"${CRLF}${CRLF}` +
			wrapBase64(b64) +
			`${CRLF}${CRLF}`;
	}
	mime += `--${mixBnd}--`;
	return mime;
}

// ─── Thread reply-header derivation ──────────────────────────────────────────

function parseMsgIdChain(header: string | undefined): string[] {
	if (!header) return [];
	const ids = [...header.matchAll(/<[^>]+>/g)].map((m) => m[0]);
	return ids.length > 0 ? ids : header.split(/\s+/).filter(Boolean);
}

// ─── Shared attachment-fetch helper (for forwarding) ─────────────────────────

async function fetchAttachmentAsStdBase64(
	accessToken: string,
	messageId: string,
	attachmentId: string,
): Promise<string> {
	const url = `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
	const data = (await gmFetch(accessToken, url)) as { data?: string };
	return urlSafeToStdBase64(data.data ?? "");
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. search_gmail_messages ──────────────────────────────────────────────
	server.tool(
		"search_gmail_messages",
		"Search Gmail messages by query string. Returns message IDs, thread IDs, and web links. Supports pagination.",
		{
			query: z
				.string()
				.describe(
					"Gmail search query (e.g. 'from:alice@example.com is:unread').",
				),
			page_size: z
				.number()
				.int()
				.default(10)
				.describe("Maximum number of messages to return (default 10)."),
			page_token: z
				.string()
				.optional()
				.describe("Pagination token from a previous response."),
		},
		async ({ query, page_size, page_token }) => {
			const { accessToken } = await ctx.getService("gmail");
			const url = buildUrl(`${GMAIL_BASE}/users/me/messages`, {
				q: query,
				maxResults: page_size,
				pageToken: page_token,
			});
			const data = (await gmFetch(accessToken, url)) as {
				messages?: Array<{ id?: string; threadId?: string }>;
				nextPageToken?: string;
			};
			const messages = data.messages ?? [];
			const nextToken = data.nextPageToken;

			if (messages.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No messages found for query: '${query}'`,
						},
					],
				};
			}

			const lines: string[] = [
				`Found ${messages.length} messages matching '${query}':`,
				"",
				"MESSAGES:",
			];
			for (let i = 0; i < messages.length; i++) {
				const msg = messages[i];
				const mid = msg.id ?? "unknown";
				const tid = msg.threadId ?? "unknown";
				lines.push(
					`  ${i + 1}. Message ID: ${mid}`,
					`     Web Link: ${mid !== "unknown" ? generateGmailWebUrl(mid) : "N/A"}`,
					`     Thread ID: ${tid}`,
					`     Thread Link: ${tid !== "unknown" ? generateGmailWebUrl(tid) : "N/A"}`,
					"",
				);
			}
			lines.push(
				"USAGE:",
				"  - Pass Message IDs to get_gmail_messages_content_batch(message_ids=[...])",
				"  - Pass Thread IDs to get_gmail_thread_content() or get_gmail_threads_content_batch()",
			);
			if (nextToken) {
				lines.push(
					"",
					`PAGINATION: Call search_gmail_messages again with page_token='${nextToken}'`,
				);
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 2. get_gmail_message_content ──────────────────────────────────────────
	server.tool(
		"get_gmail_message_content",
		"Get full content (subject, sender, recipients, body, attachments) of a single Gmail message.",
		{
			message_id: z.string().describe("Gmail message ID to retrieve."),
			body_format: z
				.enum(["text", "html", "raw"])
				.default("text")
				.describe(
					"Body output format: 'text' (default, HTML converted to text), 'html' (raw HTML), 'raw' (full MIME).",
				),
		},
		async ({ message_id, body_format }) => {
			const { accessToken } = await ctx.getService("gmail");

			// Always fetch metadata for headers
			const metaUrl = buildMetadataUrl(
				`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}`,
			);
			const metaMsg = (await gmFetch(accessToken, metaUrl)) as GmailMessage;
			const headers = extractHeaders(
				metaMsg.payload ?? {},
				GMAIL_METADATA_HEADERS,
			);

			if (body_format === "raw") {
				const rawMsg = (await gmFetch(
					accessToken,
					buildUrl(
						`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}`,
						{ format: "raw" },
					),
				)) as GmailMessage;
				const rawContent = rawMsg.raw
					? decodeBase64Url(rawMsg.raw).slice(0, RAW_BODY_TRUNCATE_LIMIT)
					: "[No raw content found]";
				const lines = formatMessageHeaderLines(headers);
				lines.push("", "--- RAW MIME ---", rawContent);
				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			}

			const fullMsg = (await gmFetch(
				accessToken,
				buildUrl(
					`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}`,
					{ format: "full" },
				),
			)) as GmailMessage;
			const payload = fullMsg.payload ?? {};
			const bodies = extractMessageBodies(payload);
			const bodyText = formatBodyContent(bodies.text, bodies.html, body_format);
			const atts = extractAttachments(payload);

			const lines = formatMessageHeaderLines(headers);
			lines.push("", "--- BODY ---", bodyText || "[No body found]");

			if (atts.length > 0) {
				lines.push("", "--- ATTACHMENTS ---");
				for (let i = 0; i < atts.length; i++) {
					const att = atts[i];
					lines.push(
						`${i + 1}. ${att.filename} (${att.mimeType}, ${(att.size / 1024).toFixed(1)} KB)`,
						`   Attachment ID: ${att.attachmentId}`,
						`   Use get_gmail_attachment_content(message_id='${message_id}', attachment_id='${att.attachmentId}') to download`,
					);
				}
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 3. get_gmail_messages_content_batch ───────────────────────────────────
	server.tool(
		"get_gmail_messages_content_batch",
		"Retrieve content of multiple Gmail messages. Processes up to 25 messages sequentially (Gmail Batch HTTP not available in this runtime).",
		{
			message_ids: z
				.array(z.string())
				.describe("List of Gmail message IDs (max 25 recommended per call)."),
			format: z
				.enum(["full", "metadata"])
				.default("full")
				.describe("'full' includes body; 'metadata' returns headers only."),
			body_format: z
				.enum(["text", "html", "raw"])
				.default("text")
				.describe(
					"Body output format when format='full': 'text' (default), 'html', or 'raw'.",
				),
		},
		async ({ message_ids, format, body_format }) => {
			const { accessToken } = await ctx.getService("gmail");

			if (message_ids.length === 0) {
				return {
					content: [
						{ type: "text" as const, text: "No message IDs provided." },
					],
				};
			}

			const chunk = message_ids.slice(0, 25);
			const outputs: string[] = [];

			for (const mid of chunk) {
				try {
					let msgOut: string;
					if (format === "metadata") {
						const data = (await gmFetch(
							accessToken,
							buildMetadataUrl(
								`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(mid)}`,
							),
						)) as GmailMessage;
						const hdrs = extractHeaders(
							data.payload ?? {},
							GMAIL_METADATA_HEADERS,
						);
						const lines = formatMessageHeaderLines(hdrs, mid);
						lines.push(`Web Link: ${generateGmailWebUrl(mid)}`);
						msgOut = lines.join("\n");
					} else if (body_format === "raw") {
						const data = (await gmFetch(
							accessToken,
							buildUrl(
								`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(mid)}`,
								{ format: "raw" },
							),
						)) as GmailMessage;
						const hdrs = extractHeaders(
							data.payload ?? {},
							GMAIL_METADATA_HEADERS,
						);
						const lines = formatMessageHeaderLines(hdrs, mid);
						lines.push(`Web Link: ${generateGmailWebUrl(mid)}`);
						const raw = data.raw
							? decodeBase64Url(data.raw).slice(0, RAW_BODY_TRUNCATE_LIMIT)
							: "[No raw content]";
						lines.push("", "--- RAW MIME ---", raw);
						msgOut = lines.join("\n");
					} else {
						const data = (await gmFetch(
							accessToken,
							buildUrl(
								`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(mid)}`,
								{ format: "full" },
							),
						)) as GmailMessage;
						const payload = data.payload ?? {};
						const hdrs = extractHeaders(payload, GMAIL_METADATA_HEADERS);
						const bodies = extractMessageBodies(payload);
						const bodyText = formatBodyContent(
							bodies.text,
							bodies.html,
							body_format,
						);
						const atts = extractAttachments(payload);
						const lines = formatMessageHeaderLines(hdrs, mid);
						lines.push(`Web Link: ${generateGmailWebUrl(mid)}`);
						lines.push("", "--- BODY ---", bodyText);
						if (atts.length > 0) {
							lines.push("", "--- ATTACHMENTS ---");
							for (let i = 0; i < atts.length; i++) {
								const att = atts[i];
								lines.push(
									`${i + 1}. ${att.filename} (${att.mimeType}, ${(att.size / 1024).toFixed(1)} KB)`,
									`   Attachment ID: ${att.attachmentId}`,
									`   Use get_gmail_attachment_content(message_id='${mid}', attachment_id='${att.attachmentId}') to download`,
								);
							}
						}
						msgOut = lines.join("\n");
					}
					outputs.push(msgOut);
				} catch (err) {
					outputs.push(`[Error fetching message ${mid}: ${String(err)}]`);
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text:
							`Retrieved ${chunk.length} message(s):\n\n` +
							outputs.join("\n---\n\n"),
					},
				],
			};
		},
	);

	// ── 4. get_gmail_attachment_content ───────────────────────────────────────
	server.tool(
		"get_gmail_attachment_content",
		"Download a Gmail attachment and return it as standard base64. Note: local file storage is not available in this runtime; content is returned inline as base64.",
		{
			message_id: z
				.string()
				.describe("Gmail message ID containing the attachment."),
			attachment_id: z
				.string()
				.describe("Attachment ID (from get_gmail_message_content)."),
			return_base64: z
				.boolean()
				.default(true)
				.describe(
					"Include standard base64 content in the response. Default true.",
				),
		},
		async ({ message_id, attachment_id, return_base64 }) => {
			const { accessToken } = await ctx.getService("gmail");

			const url = `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachment_id)}`;
			const data = (await gmFetch(accessToken, url)) as {
				size?: number;
				data?: string;
			};

			const sizeBytes = data.size ?? 0;
			const urlSafeB64 = data.data ?? "";

			// Try to resolve filename and MIME type from message metadata
			let filename = "attachment";
			let mimeType = "application/octet-stream";
			try {
				const msgUrl = buildUrl(
					`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}`,
					{
						format: "full",
						fields:
							"payload(parts(filename,mimeType,body(attachmentId,size)),filename,mimeType,body(attachmentId,size))",
					},
				);
				const msgData = (await gmFetch(accessToken, msgUrl)) as GmailMessage;
				const atts = extractAttachments(msgData.payload ?? {});
				const matched = atts.find((a) => a.attachmentId === attachment_id);
				if (matched) {
					filename = matched.filename || filename;
					mimeType = matched.mimeType || mimeType;
				} else if (atts.length === 1) {
					filename = atts[0].filename || filename;
					mimeType = atts[0].mimeType || mimeType;
				}
			} catch {
				// Non-fatal metadata fetch failure
			}

			const lines = [
				"Attachment downloaded successfully!",
				`Message ID: ${message_id}`,
				`Filename: ${filename}`,
				`MIME Type: ${mimeType}`,
				`Size: ${(sizeBytes / 1024).toFixed(1)} KB (${sizeBytes} bytes)`,
				"",
				"Note: File storage is not available in this runtime. Content is returned as base64.",
				"Note: Attachment IDs are ephemeral — always use IDs from the most recent message fetch.",
			];

			if (return_base64 && urlSafeB64) {
				const stdB64 = urlSafeToStdBase64(urlSafeB64);
				lines.push(
					"",
					`Base64 content (${stdB64.length} chars, standard base64):`,
					stdB64,
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 5. send_gmail_message ─────────────────────────────────────────────────
	server.tool(
		"send_gmail_message",
		"Send an email (new message, reply, or forward) via Gmail. Supports plain/HTML body, CC/BCC, threading, Send-As aliases, base64 attachments, and automatic signature.",
		{
			to: z.string().describe("Recipient email address(es)."),
			subject: z
				.string()
				.optional()
				.describe(
					"Email subject. Required for new emails; optional when forwarding (defaults to 'Fwd: <original>').",
				),
			body: z
				.string()
				.optional()
				.describe(
					"Email body. Required for new emails; optional when forwarding (prepended as a note).",
				),
			body_format: z
				.enum(["plain", "html"])
				.default("plain")
				.describe("Body format: 'plain' (default) or 'html'."),
			forward_message_id: z
				.string()
				.optional()
				.describe(
					"Gmail message ID to forward. When set, fetches and quotes the original message.",
				),
			include_forwarded_attachments: z
				.boolean()
				.default(true)
				.describe(
					"When forwarding, include original message's attachments. Default true.",
				),
			cc: z.string().optional().describe("CC email address(es)."),
			bcc: z.string().optional().describe("BCC email address(es)."),
			from_name: z
				.string()
				.optional()
				.describe(
					"Sender display name (e.g. 'Alice Smith'). Formats From header as 'Name <email>'.",
				),
			from_email: z
				.string()
				.optional()
				.describe(
					"Send-As alias email (must be configured in Gmail Settings > Accounts). Defaults to the connected account email.",
				),
			thread_id: z
				.string()
				.optional()
				.describe("Gmail thread ID to reply within."),
			in_reply_to: z
				.string()
				.optional()
				.describe("RFC Message-ID of the message being replied to."),
			references: z
				.string()
				.optional()
				.describe("Chain of RFC Message-IDs for threading."),
			attachments: z
				.array(
					z.object({
						content: z
							.string()
							.optional()
							.describe("Standard (non-URL-safe) base64-encoded file content."),
						filename: z
							.string()
							.optional()
							.describe("Filename for the attachment."),
						mime_type: z
							.string()
							.optional()
							.describe("MIME type (defaults to 'application/octet-stream')."),
					}),
				)
				.optional()
				.describe(
					"Optional attachments: each needs 'content' (standard base64) and 'filename'.",
				),
			include_signature: z
				.boolean()
				.default(true)
				.describe(
					"Append the Gmail signature from Settings > Signature. Default true.",
				),
		},
		async ({
			to,
			subject,
			body,
			body_format,
			forward_message_id,
			include_forwarded_attachments,
			cc,
			bcc,
			from_name,
			from_email,
			thread_id,
			in_reply_to,
			references,
			attachments,
			include_signature,
		}) => {
			const { accessToken, accountEmail } = await ctx.getService("gmail");
			const senderEmail = from_email ?? accountEmail;
			const fromHeader = from_name
				? `${from_name
						.replace(/[\r\n]/g, "")
						.split("\x00")
						.join("")} <${senderEmail}>`
				: senderEmail;

			// ── Forward path ──────────────────────────────────────────────────
			if (forward_message_id) {
				const origMsg = (await gmFetch(
					accessToken,
					buildUrl(
						`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(forward_message_id)}`,
						{ format: "full" },
					),
				)) as GmailMessage;
				const origPayload = origMsg.payload ?? {};
				const origHeaders = extractHeaders(origPayload, [
					"Subject",
					"From",
					"Date",
					"To",
				]);
				const origBodies = extractMessageBodies(origPayload);
				const {
					subject: fwdSubject,
					body: fwdBody,
					bodyFormat: fwdFmt,
				} = buildForwardContent({
					headers: origHeaders,
					bodies: origBodies,
					forwardNote: body ?? null,
					noteFormat: body_format,
					subjectOverride: subject ?? null,
				});

				const mimeAtts: MimeAttachment[] = [];
				if (include_forwarded_attachments) {
					const origAtts = extractAttachments(origPayload);
					const failed: string[] = [];
					for (const att of origAtts) {
						try {
							const stdB64 = await fetchAttachmentAsStdBase64(
								accessToken,
								forward_message_id,
								att.attachmentId,
							);
							mimeAtts.push({
								filename: att.filename,
								mimeType: att.mimeType,
								content: stdB64,
							});
						} catch {
							failed.push(att.filename);
						}
					}
					if (failed.length > 0) {
						throw new Error(
							`Failed to include forwarded attachment(s): ${failed.join(", ")}`,
						);
					}
				}

				const rawMime = buildRawMime({
					to,
					from: fromHeader,
					cc,
					bcc,
					subject: fwdSubject,
					body: fwdBody,
					bodyFormat: fwdFmt,
					attachments: mimeAtts.length > 0 ? mimeAtts : undefined,
				});
				const sent = (await gmFetch(
					accessToken,
					`${GMAIL_BASE}/users/me/messages/send`,
					{
						method: "POST",
						body: JSON.stringify({ raw: mimeToUrlSafeBase64(rawMime) }),
					},
				)) as { id?: string };
				const note =
					mimeAtts.length > 0 ? ` with ${mimeAtts.length} attachment(s)` : "";
				return {
					content: [
						{
							type: "text" as const,
							text: `Email forwarded${note}! Message ID: ${sent.id ?? "unknown"}`,
						},
					],
				};
			}

			// ── Regular send ─────────────────────────────────────────────────
			if (!subject || !body) {
				throw new Error(
					"Both 'subject' and 'body' are required when sending a new email. Use 'forward_message_id' to forward an existing message.",
				);
			}

			// Derive thread reply headers if thread_id provided
			let resolvedInReplyTo = in_reply_to;
			let resolvedRefs = references;
			if (thread_id && (!resolvedInReplyTo || !resolvedRefs)) {
				try {
					const threadData = (await gmFetch(
						accessToken,
						buildUrl(
							`${GMAIL_BASE}/users/me/threads/${encodeURIComponent(thread_id)}`,
							{ format: "metadata", metadataHeaders: "Message-ID" },
						),
					)) as GmailThread;
					const msgIds = (threadData.messages ?? [])
						.filter((m) => !(m.labelIds ?? []).includes("TRASH"))
						.map((m) => {
							for (const h of m.payload?.headers ?? []) {
								if (h.name === "Message-ID") return h.value;
							}
							return "";
						})
						.filter(Boolean);
					if (!resolvedInReplyTo) {
						const chain = parseMsgIdChain(resolvedRefs);
						resolvedInReplyTo =
							chain.length > 0
								? chain[chain.length - 1]
								: msgIds[msgIds.length - 1];
					}
					if (!resolvedRefs) {
						if (resolvedInReplyTo && msgIds.includes(resolvedInReplyTo)) {
							const idx = msgIds.indexOf(resolvedInReplyTo);
							resolvedRefs = msgIds.slice(0, idx + 1).join(" ");
						} else {
							resolvedRefs = resolvedInReplyTo ?? msgIds.join(" ");
						}
					}
				} catch {
					// Non-fatal
				}
			}

			let bodyContent = body;
			if (include_signature) {
				const sigHtml = await fetchSignatureHtml(accessToken, senderEmail);
				bodyContent = appendSignature(bodyContent, body_format, sigHtml);
			}

			let finalSubject = subject;
			if (resolvedInReplyTo && !finalSubject.toLowerCase().startsWith("re:")) {
				finalSubject = `Re: ${finalSubject}`;
			}

			const mimeAtts: MimeAttachment[] = [];
			for (const att of attachments ?? []) {
				if (att.content && att.filename) {
					mimeAtts.push({
						filename: att.filename,
						mimeType: att.mime_type ?? "application/octet-stream",
						content: att.content,
					});
				}
			}

			const rawMime = buildRawMime({
				to,
				from: fromHeader,
				cc,
				bcc,
				subject: finalSubject,
				inReplyTo: resolvedInReplyTo,
				references: resolvedRefs,
				body: bodyContent,
				bodyFormat: body_format,
				attachments: mimeAtts.length > 0 ? mimeAtts : undefined,
			});

			const sendBody: Record<string, string> = {
				raw: mimeToUrlSafeBase64(rawMime),
			};
			if (thread_id) sendBody.threadId = thread_id;

			const sent = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/messages/send`,
				{ method: "POST", body: JSON.stringify(sendBody) },
			)) as { id?: string };
			const note =
				mimeAtts.length > 0 ? ` with ${mimeAtts.length} attachment(s)` : "";
			return {
				content: [
					{
						type: "text" as const,
						text: `Email sent${note}! Message ID: ${sent.id ?? "unknown"}`,
					},
				],
			};
		},
	);

	// ── 6. draft_gmail_message ────────────────────────────────────────────────
	server.tool(
		"draft_gmail_message",
		"Create an email draft in Gmail. Supports plain/HTML body, CC/BCC, reply threading, Send-As aliases, base64 attachments, and automatic signature.",
		{
			subject: z.string().describe("Email subject."),
			body: z.string().describe("Email body content."),
			body_format: z
				.enum(["plain", "html"])
				.default("plain")
				.describe("Body format: 'plain' (default) or 'html'."),
			to: z
				.string()
				.optional()
				.describe("Recipient email address(es). Can be empty for drafts."),
			cc: z.string().optional().describe("CC email address(es)."),
			bcc: z.string().optional().describe("BCC email address(es)."),
			from_name: z.string().optional().describe("Sender display name."),
			from_email: z
				.string()
				.optional()
				.describe(
					"Send-As alias email (must be configured in Gmail Settings > Accounts). Defaults to connected account email.",
				),
			thread_id: z
				.string()
				.optional()
				.describe("Gmail thread ID to reply within."),
			in_reply_to: z
				.string()
				.optional()
				.describe("RFC Message-ID of the message being replied to."),
			references: z
				.string()
				.optional()
				.describe("Chain of RFC Message-IDs for threading."),
			attachments: z
				.array(
					z.object({
						content: z
							.string()
							.optional()
							.describe("Standard base64-encoded file content."),
						filename: z.string().optional().describe("Filename."),
						mime_type: z.string().optional().describe("MIME type."),
					}),
				)
				.optional()
				.describe(
					"Optional attachments: each needs 'content' (standard base64) and 'filename'.",
				),
			include_signature: z
				.boolean()
				.default(true)
				.describe("Append Gmail signature. Default true."),
		},
		async ({
			subject,
			body,
			body_format,
			to,
			cc,
			bcc,
			from_name,
			from_email,
			thread_id,
			in_reply_to,
			references,
			attachments,
			include_signature,
		}) => {
			const { accessToken, accountEmail } = await ctx.getService("gmail");
			const senderEmail = from_email ?? accountEmail;
			const fromHeader = from_name
				? `${from_name
						.replace(/[\r\n]/g, "")
						.split("\x00")
						.join("")} <${senderEmail}>`
				: senderEmail;

			let resolvedTo = to;
			let resolvedSubject = subject;
			let resolvedInReplyTo = in_reply_to;
			let resolvedRefs = references;

			// Derive thread context
			if (thread_id) {
				try {
					const threadData = (await gmFetch(
						accessToken,
						buildThreadMetadataUrl(thread_id, [
							"Message-ID",
							"Subject",
							"From",
							"Reply-To",
							"To",
							"Cc",
						]),
					)) as GmailThread;
					const msgs = (threadData.messages ?? []).filter(
						(m) => !(m.labelIds ?? []).includes("TRASH"),
					);
					const msgIds = msgs
						.map((m) => {
							for (const h of m.payload?.headers ?? []) {
								if (h.name === "Message-ID") return h.value;
							}
							return "";
						})
						.filter(Boolean);
					const lastMsg = msgs[msgs.length - 1];
					const lastHdrs: Record<string, string> = {};
					for (const h of lastMsg?.payload?.headers ?? []) {
						lastHdrs[h.name] = h.value;
					}

					if (!resolvedInReplyTo) {
						const chain = parseMsgIdChain(resolvedRefs);
						resolvedInReplyTo =
							chain.length > 0
								? chain[chain.length - 1]
								: msgIds[msgIds.length - 1];
					}
					if (!resolvedRefs) {
						if (resolvedInReplyTo && msgIds.includes(resolvedInReplyTo)) {
							const idx = msgIds.indexOf(resolvedInReplyTo);
							resolvedRefs = msgIds.slice(0, idx + 1).join(" ");
						} else {
							resolvedRefs = resolvedInReplyTo ?? msgIds.join(" ");
						}
					}
					if (!resolvedTo) {
						resolvedTo = lastHdrs["Reply-To"] || lastHdrs["From"] || resolvedTo;
					}
					if (!resolvedSubject?.trim() && lastHdrs["Subject"]) {
						resolvedSubject = lastHdrs["Subject"];
					}
				} catch {
					// Non-fatal
				}
			}

			let bodyContent = body;
			if (include_signature) {
				const sigHtml = await fetchSignatureHtml(accessToken, senderEmail);
				bodyContent = appendSignature(bodyContent, body_format, sigHtml);
			}

			const mimeAtts: MimeAttachment[] = [];
			for (const att of attachments ?? []) {
				if (att.content && att.filename) {
					mimeAtts.push({
						filename: att.filename,
						mimeType: att.mime_type ?? "application/octet-stream",
						content: att.content,
					});
				}
			}

			const rawMime = buildRawMime({
				to: resolvedTo,
				from: fromHeader,
				cc,
				bcc,
				subject: resolvedSubject,
				inReplyTo: resolvedInReplyTo,
				references: resolvedRefs,
				body: bodyContent,
				bodyFormat: body_format,
				attachments: mimeAtts.length > 0 ? mimeAtts : undefined,
			});

			const created = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/drafts`,
				{
					method: "POST",
					body: JSON.stringify({
						message: { raw: mimeToUrlSafeBase64(rawMime) },
					}),
				},
			)) as { id?: string };
			const note =
				mimeAtts.length > 0 ? ` with ${mimeAtts.length} attachment(s)` : "";
			return {
				content: [
					{
						type: "text" as const,
						text: `Draft created${note}! Draft ID: ${created.id ?? "unknown"}`,
					},
				],
			};
		},
	);

	// ── 7. get_gmail_thread_content ───────────────────────────────────────────
	server.tool(
		"get_gmail_thread_content",
		"Get all messages in a Gmail thread. Optionally returns structured thread ownership analysis (last sender, ball-in-court verdict, participant counts).",
		{
			thread_id: z.string().describe("Gmail thread ID."),
			body_format: z
				.enum(["text", "html", "raw"])
				.default("text")
				.describe(
					"Body format: 'text' (default), 'html', or 'raw' (full MIME per message).",
				),
			include_analysis: z
				.boolean()
				.default(false)
				.describe(
					"When true, appends JSON thread-ownership analysis (last_sender, ball_in_court_of, message_count_by_sender, participants).",
				),
		},
		async ({ thread_id, body_format, include_analysis }) => {
			const { accessToken, accountEmail } = await ctx.getService("gmail");

			const thread = (await gmFetch(
				accessToken,
				buildUrl(
					`${GMAIL_BASE}/users/me/threads/${encodeURIComponent(thread_id)}`,
					{ format: "full" },
				),
			)) as GmailThread;

			let rawContents: Record<string, string> | undefined;
			if (body_format === "raw") {
				rawContents = {};
				for (const msg of thread.messages ?? []) {
					if (!msg.id) continue;
					try {
						const rawMsg = (await gmFetch(
							accessToken,
							buildUrl(
								`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(msg.id)}`,
								{ format: "raw" },
							),
						)) as GmailMessage;
						rawContents[msg.id] = rawMsg.raw
							? decodeBase64Url(rawMsg.raw).slice(0, RAW_BODY_TRUNCATE_LIMIT)
							: "[No raw content found]";
					} catch {
						rawContents[msg.id] = "[Failed to fetch raw MIME]";
					}
				}
			}

			const content = formatThreadContent(
				thread,
				thread_id,
				body_format,
				rawContents,
			);
			if (!include_analysis) {
				return { content: [{ type: "text" as const, text: content }] };
			}

			const analysis = analyzeThreadOwnership(thread, accountEmail);
			return {
				content: [
					{
						type: "text" as const,
						text:
							content +
							"\n\n--- THREAD ANALYSIS ---\n" +
							JSON.stringify(analysis, null, 2),
					},
				],
			};
		},
	);

	// ── 8. get_gmail_threads_content_batch ────────────────────────────────────
	server.tool(
		"get_gmail_threads_content_batch",
		"Retrieve multiple Gmail threads. Processes up to 25 sequentially (Gmail Batch HTTP not available in this runtime).",
		{
			thread_ids: z
				.array(z.string())
				.describe("List of Gmail thread IDs (max 25 recommended)."),
			body_format: z
				.enum(["text", "html", "raw"])
				.default("text")
				.describe("Body format: 'text' (default), 'html', or 'raw'."),
		},
		async ({ thread_ids, body_format }) => {
			const { accessToken } = await ctx.getService("gmail");
			if (thread_ids.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No thread IDs provided." }],
				};
			}
			const chunk = thread_ids.slice(0, 25);
			const outputs: string[] = [];
			for (const tid of chunk) {
				try {
					const thread = (await gmFetch(
						accessToken,
						buildUrl(
							`${GMAIL_BASE}/users/me/threads/${encodeURIComponent(tid)}`,
							{ format: "full" },
						),
					)) as GmailThread;

					let rawContents: Record<string, string> | undefined;
					if (body_format === "raw") {
						rawContents = {};
						for (const msg of thread.messages ?? []) {
							if (!msg.id) continue;
							try {
								const rawMsg = (await gmFetch(
									accessToken,
									buildUrl(
										`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(msg.id)}`,
										{ format: "raw" },
									),
								)) as GmailMessage;
								rawContents[msg.id] = rawMsg.raw
									? decodeBase64Url(rawMsg.raw).slice(
											0,
											RAW_BODY_TRUNCATE_LIMIT,
										)
									: "[No raw content found]";
							} catch {
								rawContents[msg.id] = "[Failed to fetch raw MIME]";
							}
						}
					}
					outputs.push(
						formatThreadContent(thread, tid, body_format, rawContents),
					);
				} catch (err) {
					outputs.push(`[Error fetching thread ${tid}: ${String(err)}]`);
				}
			}
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Retrieved ${chunk.length} thread(s):\n\n` +
							outputs.join("\n---\n\n"),
					},
				],
			};
		},
	);

	// ── 9. list_gmail_labels ──────────────────────────────────────────────────
	server.tool(
		"list_gmail_labels",
		"List all Gmail labels (system and user-defined) for the connected account.",
		{},
		async () => {
			const { accessToken } = await ctx.getService("gmail");
			const data = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/labels`,
			)) as { labels?: GmailLabel[] };
			const labels = data.labels ?? [];
			if (labels.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No labels found." }],
				};
			}
			const system = labels.filter((l) => l.type === "system");
			const user = labels.filter((l) => l.type !== "system");
			const lines: string[] = [`Found ${labels.length} labels:`, ""];
			if (system.length > 0) {
				lines.push("SYSTEM LABELS:");
				for (const l of system)
					lines.push(`  - ${l.name ?? "(unnamed)"} (ID: ${l.id ?? "?"})`);
				lines.push("");
			}
			if (user.length > 0) {
				lines.push("USER LABELS:");
				for (const l of user)
					lines.push(`  - ${l.name ?? "(unnamed)"} (ID: ${l.id ?? "?"})`);
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 10. manage_gmail_label ────────────────────────────────────────────────
	server.tool(
		"manage_gmail_label",
		"Create, update, or delete a Gmail label.",
		{
			action: z
				.enum(["create", "update", "delete"])
				.describe("Action to perform."),
			name: z
				.string()
				.optional()
				.describe("Label name. Required for create; optional for update."),
			label_id: z
				.string()
				.optional()
				.describe("Label ID. Required for update and delete."),
			label_list_visibility: z
				.enum(["labelShow", "labelHide"])
				.default("labelShow")
				.describe("Show/hide in label list."),
			message_list_visibility: z
				.enum(["show", "hide"])
				.default("show")
				.describe("Show/hide in message list."),
		},
		async ({
			action,
			name,
			label_id,
			label_list_visibility,
			message_list_visibility,
		}) => {
			const { accessToken } = await ctx.getService("gmail");

			if (action === "create") {
				if (!name) throw new Error("Label name is required for create.");
				const body = {
					name,
					labelListVisibility: label_list_visibility,
					messageListVisibility: message_list_visibility,
				};
				const created = (await gmFetch(
					accessToken,
					`${GMAIL_BASE}/users/me/labels`,
					{ method: "POST", body: JSON.stringify(body) },
				)) as GmailLabel;
				return {
					content: [
						{
							type: "text" as const,
							text: `Label created!\nName: ${created.name ?? name}\nID: ${created.id ?? "unknown"}`,
						},
					],
				};
			}

			if (!label_id)
				throw new Error("Label ID is required for update and delete.");

			if (action === "update") {
				const current = (await gmFetch(
					accessToken,
					`${GMAIL_BASE}/users/me/labels/${encodeURIComponent(label_id)}`,
				)) as GmailLabel;
				const body = {
					id: label_id,
					name: name ?? current.name ?? "",
					labelListVisibility: label_list_visibility,
					messageListVisibility: message_list_visibility,
				};
				const updated = (await gmFetch(
					accessToken,
					`${GMAIL_BASE}/users/me/labels/${encodeURIComponent(label_id)}`,
					{ method: "PUT", body: JSON.stringify(body) },
				)) as GmailLabel;
				return {
					content: [
						{
							type: "text" as const,
							text: `Label updated!\nName: ${updated.name ?? name ?? current.name ?? ""}\nID: ${updated.id ?? label_id}`,
						},
					],
				};
			}

			// delete
			const labelData = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/labels/${encodeURIComponent(label_id)}`,
			)) as GmailLabel;
			await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/labels/${encodeURIComponent(label_id)}`,
				{ method: "DELETE" },
			);
			return {
				content: [
					{
						type: "text" as const,
						text: `Label '${labelData.name ?? label_id}' (ID: ${label_id}) deleted.`,
					},
				],
			};
		},
	);

	// ── 11. list_gmail_filters ────────────────────────────────────────────────
	server.tool(
		"list_gmail_filters",
		"List all Gmail filters configured in the connected account.",
		{},
		async () => {
			const { accessToken } = await ctx.getService("gmail");
			const data = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/settings/filters`,
			)) as { filter?: GmailFilterObj[] };
			const filters = data.filter ?? [];

			if (filters.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No filters found." }],
				};
			}

			const lines: string[] = [`Found ${filters.length} filter(s):`, ""];
			for (const f of filters) {
				const fid = f.id ?? "(no id)";
				const crit = f.criteria ?? {};
				const act = f.action ?? {};
				lines.push(`Filter ID: ${fid}`, "  Criteria:");
				const critLines: string[] = [];
				if (crit["from"]) critLines.push(`From: ${String(crit["from"])}`);
				if (crit["to"]) critLines.push(`To: ${String(crit["to"])}`);
				if (crit["subject"])
					critLines.push(`Subject: ${String(crit["subject"])}`);
				if (crit["query"]) critLines.push(`Query: ${String(crit["query"])}`);
				if (crit["negatedQuery"])
					critLines.push(`Exclude: ${String(crit["negatedQuery"])}`);
				if (crit["hasAttachment"]) critLines.push("Has attachment");
				if (crit["excludeChats"]) critLines.push("Exclude chats");
				if (critLines.length === 0) critLines.push("(none)");
				for (const cl of critLines) lines.push(`    - ${cl}`);

				lines.push("  Actions:");
				const actLines: string[] = [];
				if (act["forward"])
					actLines.push(`Forward to: ${String(act["forward"])}`);
				const addIds = act["addLabelIds"];
				if (Array.isArray(addIds) && addIds.length > 0)
					actLines.push(`Add labels: ${(addIds as string[]).join(", ")}`);
				const remIds = act["removeLabelIds"];
				if (Array.isArray(remIds) && remIds.length > 0)
					actLines.push(`Remove labels: ${(remIds as string[]).join(", ")}`);
				if (actLines.length === 0) actLines.push("(none)");
				for (const al of actLines) lines.push(`    - ${al}`);
				lines.push("");
			}
			return {
				content: [{ type: "text" as const, text: lines.join("\n").trimEnd() }],
			};
		},
	);

	// ── 12. manage_gmail_filter ───────────────────────────────────────────────
	server.tool(
		"manage_gmail_filter",
		"Create or delete a Gmail filter.",
		{
			action: z
				.enum(["create", "delete"])
				.describe("Action: 'create' or 'delete'."),
			criteria: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					"Filter criteria (required for create). Fields: from, to, subject, query, negatedQuery, hasAttachment (bool), excludeChats (bool).",
				),
			filter_action: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					"Filter action (required for create). Fields: addLabelIds (string[]), removeLabelIds (string[]), forward (string).",
				),
			filter_id: z
				.string()
				.optional()
				.describe("Filter ID (required for delete)."),
		},
		async ({ action, criteria, filter_action, filter_id }) => {
			const { accessToken } = await ctx.getService("gmail");

			if (action === "create") {
				if (!criteria || !filter_action)
					throw new Error(
						"'criteria' and 'filter_action' are required for create.",
					);
				const created = (await gmFetch(
					accessToken,
					`${GMAIL_BASE}/users/me/settings/filters`,
					{
						method: "POST",
						body: JSON.stringify({ criteria, action: filter_action }),
					},
				)) as { id?: string };
				return {
					content: [
						{
							type: "text" as const,
							text: `Filter created!\nFilter ID: ${created.id ?? "unknown"}`,
						},
					],
				};
			}

			// delete
			if (!filter_id) throw new Error("'filter_id' is required for delete.");
			const existing = (await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/settings/filters/${encodeURIComponent(filter_id)}`,
			)) as GmailFilterObj;
			await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/settings/filters/${encodeURIComponent(filter_id)}`,
				{ method: "DELETE" },
			);
			return {
				content: [
					{
						type: "text" as const,
						text:
							`Filter deleted!\nFilter ID: ${filter_id}\n` +
							`Criteria: ${JSON.stringify(existing.criteria ?? {})}\n` +
							`Action: ${JSON.stringify(existing.action ?? {})}`,
					},
				],
			};
		},
	);

	// ── 13. modify_gmail_message_labels ───────────────────────────────────────
	server.tool(
		"modify_gmail_message_labels",
		"Add or remove labels on a single Gmail message. Archive = remove INBOX; Trash = add TRASH.",
		{
			message_id: z.string().describe("Gmail message ID to modify."),
			add_label_ids: z
				.array(z.string())
				.optional()
				.describe("Label IDs to add."),
			remove_label_ids: z
				.array(z.string())
				.optional()
				.describe("Label IDs to remove."),
		},
		async ({ message_id, add_label_ids, remove_label_ids }) => {
			const { accessToken } = await ctx.getService("gmail");
			if (
				(add_label_ids?.length ?? 0) === 0 &&
				(remove_label_ids?.length ?? 0) === 0
			) {
				throw new Error(
					"At least one of add_label_ids or remove_label_ids must be provided.",
				);
			}
			const body: Record<string, unknown> = {};
			if (add_label_ids?.length) body.addLabelIds = add_label_ids;
			if (remove_label_ids?.length) body.removeLabelIds = remove_label_ids;

			await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}/modify`,
				{ method: "POST", body: JSON.stringify(body) },
			);

			const actions: string[] = [];
			if (add_label_ids?.length)
				actions.push(`Added: ${add_label_ids.join(", ")}`);
			if (remove_label_ids?.length)
				actions.push(`Removed: ${remove_label_ids.join(", ")}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Message labels updated!\nMessage ID: ${message_id}\n${actions.join("; ")}`,
					},
				],
			};
		},
	);

	// ── 14. batch_modify_gmail_message_labels ─────────────────────────────────
	server.tool(
		"batch_modify_gmail_message_labels",
		"Add or remove labels on multiple Gmail messages in a single API call.",
		{
			message_ids: z
				.array(z.string())
				.describe("List of Gmail message IDs to modify."),
			add_label_ids: z
				.array(z.string())
				.optional()
				.describe("Label IDs to add to all messages."),
			remove_label_ids: z
				.array(z.string())
				.optional()
				.describe("Label IDs to remove from all messages."),
		},
		async ({ message_ids, add_label_ids, remove_label_ids }) => {
			const { accessToken } = await ctx.getService("gmail");
			if (
				(add_label_ids?.length ?? 0) === 0 &&
				(remove_label_ids?.length ?? 0) === 0
			) {
				throw new Error(
					"At least one of add_label_ids or remove_label_ids must be provided.",
				);
			}
			const body: Record<string, unknown> = { ids: message_ids };
			if (add_label_ids?.length) body.addLabelIds = add_label_ids;
			if (remove_label_ids?.length) body.removeLabelIds = remove_label_ids;

			await gmFetch(
				accessToken,
				`${GMAIL_BASE}/users/me/messages/batchModify`,
				{ method: "POST", body: JSON.stringify(body) },
			);

			const actions: string[] = [];
			if (add_label_ids?.length)
				actions.push(`Added: ${add_label_ids.join(", ")}`);
			if (remove_label_ids?.length)
				actions.push(`Removed: ${remove_label_ids.join(", ")}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Labels updated for ${message_ids.length} message(s): ${actions.join("; ")}`,
					},
				],
			};
		},
	);
}
