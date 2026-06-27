// Google Chat tools — 6 tools for the `gchat` service.
//
// Module pattern (same for all service modules):
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// Base URL: https://chat.googleapis.com/v1
// Auth: ctx.getService("gchat") → accessToken, shared via googleApiFetch.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URL ──────────────────────────────────────────────────────────────

const CHAT_BASE = "https://chat.googleapis.com/v1";

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

// ─── Response types ────────────────────────────────────────────────────────────

interface ChatSpace {
	name?: string;
	displayName?: string;
	spaceType?: string;
}

interface ChatSpacesListResponse {
	spaces?: ChatSpace[];
	nextPageToken?: string;
}

interface ChatAttachment {
	name?: string;
	contentName?: string;
	contentType?: string;
	source?: string;
	attachmentDataRef?: { resourceName?: string };
}

interface ChatAnnotation {
	type?: string;
	richLinkMetadata?: { uri?: string };
}

interface ChatEmojiReactionSummary {
	emoji?: { unicode?: string; customEmoji?: { uid?: string } };
	reactionCount?: number;
}

interface ChatMessage {
	name?: string;
	sender?: { name?: string; displayName?: string };
	createTime?: string;
	text?: string;
	attachment?: ChatAttachment[];
	annotations?: ChatAnnotation[];
	thread?: { name?: string };
	threadReply?: boolean;
	emojiReactionSummaries?: ChatEmojiReactionSummary[];
}

interface ChatMessageWithSpace extends ChatMessage {
	_spaceName: string;
}

interface ChatMessagesListResponse {
	messages?: ChatMessage[];
	nextPageToken?: string;
}

// ─── In-memory sender name cache ───────────────────────────────────────────────

const SENDER_CACHE_MAX_SIZE = 256;
const senderNameCache = new Map<string, string>();

function cacheSender(userId: string, name: string): void {
	if (senderNameCache.size >= SENDER_CACHE_MAX_SIZE) {
		// Evict the first half of entries to keep the cache bounded.
		const toRemove = Array.from(senderNameCache.keys()).slice(
			0,
			SENDER_CACHE_MAX_SIZE / 2,
		);
		for (const k of toRemove) senderNameCache.delete(k);
	}
	senderNameCache.set(userId, name);
}

// ─── Sender name resolver ──────────────────────────────────────────────────────
//
// Fast path: use displayName if the Chat API already provided it.
// Slow path: look up via People API (best-effort, requires contacts.readonly scope).
//            Errors are always caught — a failure never propagates.

async function resolveSender(
	accessToken: string,
	senderObj: { name?: string; displayName?: string },
): Promise<string> {
	const displayName = senderObj.displayName;
	if (displayName) return displayName;

	const userId = senderObj.name ?? "";
	if (!userId) return "Unknown Sender";

	const cached = senderNameCache.get(userId);
	if (cached !== undefined) return cached;

	// Chat uses "users/<id>"; People API expects "people/<id>"
	const peopleResource = userId.replace(/^users\//, "people/");
	try {
		const personUrl = buildUrl(
			`https://people.googleapis.com/v1/${peopleResource}`,
			{ personFields: "names,emailAddresses" },
		);
		const person = (await googleApiFetch(accessToken, personUrl)) as {
			names?: Array<{ displayName?: string }>;
			emailAddresses?: Array<{ value?: string }>;
		};
		const firstName = person.names?.[0]?.displayName;
		if (firstName) {
			cacheSender(userId, firstName);
			return firstName;
		}
		const firstEmail = person.emailAddresses?.[0]?.value;
		if (firstEmail) {
			cacheSender(userId, firstEmail);
			return firstEmail;
		}
	} catch {
		// People API unavailable or scope not granted — fall through.
	}

	cacheSender(userId, userId);
	return userId;
}

// ─── Rich link extractor ───────────────────────────────────────────────────────
//
// RICH_LINK annotations embed Drive/Workspace URLs that appear as smart chips
// in Chat. They are NOT in the message text field.

function extractRichLinks(msg: ChatMessage): string[] {
	const text = msg.text ?? "";
	const urls: string[] = [];
	for (const ann of msg.annotations ?? []) {
		if (ann.type === "RICH_LINK") {
			const uri = ann.richLinkMetadata?.uri ?? "";
			if (uri && !text.includes(uri)) urls.push(uri);
		}
	}
	return urls;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_spaces ────────────────────────────────────────────────────────
	server.tool(
		"list_spaces",
		"List Google Chat spaces (rooms and direct messages) accessible to the connected account.",
		{
			space_type: z
				.enum(["all", "room", "dm"])
				.default("all")
				.describe(
					'Filter by space type: "all", "room" (SPACE), or "dm" (DIRECT_MESSAGE).',
				),
			page_size: z
				.number()
				.int()
				.default(20)
				.describe("Maximum number of spaces to return (default 20)."),
		},
		async ({ space_type, page_size }) => {
			const { accessToken } = await ctx.getService("gchat");

			const params: Record<string, string | number | null | undefined> = {
				pageSize: page_size,
			};
			if (space_type === "room") params.filter = "spaceType = SPACE";
			else if (space_type === "dm")
				params.filter = "spaceType = DIRECT_MESSAGE";

			const data = (await googleApiFetch(
				accessToken,
				buildUrl(`${CHAT_BASE}/spaces`, params),
			)) as ChatSpacesListResponse;

			const spaces = data.spaces ?? [];
			if (spaces.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No Chat spaces found for type '${space_type}'.`,
						},
					],
				};
			}

			const lines = [
				`Found ${spaces.length} Chat space(s) (type: ${space_type}):`,
			];
			for (const space of spaces) {
				const name = space.displayName ?? "Unnamed Space";
				const id = space.name ?? "";
				const type = space.spaceType ?? "UNKNOWN";
				lines.push(`- ${name} (ID: ${id}, Type: ${type})`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_messages ───────────────────────────────────────────────────────
	server.tool(
		"get_messages",
		"Retrieve messages from a Google Chat space. Supports pagination and filter by time or thread.",
		{
			space_name: z
				.string()
				.describe(
					"Space resource name (e.g. 'spaces/AAAA'). Use list_spaces to find this.",
				),
			page_size: z
				.number()
				.int()
				.default(25)
				.describe("Maximum number of messages to return (default 25)."),
			page_token: z
				.string()
				.optional()
				.describe(
					"Pagination token from a previous response to fetch the next page.",
				),
			filter: z
				.string()
				.optional()
				.describe(
					"Filter using Chat API filter syntax. Supports createTime and thread.name. " +
						"E.g. 'createTime > \"2026-01-01T00:00:00Z\"' or 'thread.name = spaces/X/threads/Y'.",
				),
		},
		async ({ space_name, page_size, page_token, filter }) => {
			const { accessToken } = await ctx.getService("gchat");

			// Fetch space display name (best-effort).
			let spaceDisplayName = space_name;
			try {
				const spaceInfo = (await googleApiFetch(
					accessToken,
					`${CHAT_BASE}/${space_name}`,
				)) as ChatSpace;
				spaceDisplayName = spaceInfo.displayName ?? space_name;
			} catch {
				// Non-critical; continue without display name.
			}

			const url = buildUrl(`${CHAT_BASE}/${space_name}/messages`, {
				pageSize: page_size,
				pageToken: page_token,
				filter,
				orderBy: "createTime desc",
			});
			const data = (await googleApiFetch(
				accessToken,
				url,
			)) as ChatMessagesListResponse;

			const messages = data.messages ?? [];
			if (messages.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No messages found in space '${spaceDisplayName}' (ID: ${space_name}).`,
						},
					],
				};
			}

			// Collect unique senders, then resolve sequentially.
			const senderKeys = new Map<
				string,
				{ name?: string; displayName?: string }
			>();
			for (const msg of messages) {
				const s = msg.sender ?? {};
				const key = s.name ?? "";
				if (key && !senderKeys.has(key)) senderKeys.set(key, s);
			}
			const senderMap = new Map<string, string>();
			for (const [key, senderObj] of senderKeys) {
				senderMap.set(key, await resolveSender(accessToken, senderObj));
			}

			const lines = [
				`Messages from '${spaceDisplayName}' (ID: ${space_name}):\n`,
			];
			for (const msg of messages) {
				const senderObj = msg.sender ?? {};
				const senderKey = senderObj.name ?? "";
				const sender =
					senderMap.get(senderKey) ??
					(await resolveSender(accessToken, senderObj));
				const createTime = msg.createTime ?? "Unknown Time";
				const textContent = msg.text ?? "No text content";
				const msgName = msg.name ?? "";

				lines.push(`[${createTime}] ${sender}:`);
				lines.push(`  ${textContent}`);

				for (const richLink of extractRichLinks(msg)) {
					lines.push(`  [linked: ${richLink}]`);
				}

				const attachments = msg.attachment ?? [];
				for (let idx = 0; idx < attachments.length; idx++) {
					const att = attachments[idx];
					const attName = att.contentName ?? "unnamed";
					const attType = att.contentType ?? "unknown type";
					const attResource =
						att.attachmentDataRef?.resourceName ?? att.name ?? "";
					lines.push(`  [attachment ${idx}: ${attName} (${attType})]`);
					if (attResource) {
						lines.push(
							`  Use download_chat_attachment(space_name='${space_name}', message_id='${msgName}', attachment_resource_name='${attResource}') to download`,
						);
					}
				}

				if (msg.threadReply && msg.thread?.name) {
					lines.push(`  [thread: ${msg.thread.name}]`);
				}

				const reactions = msg.emojiReactionSummaries ?? [];
				if (reactions.length > 0) {
					const parts: string[] = [];
					for (const r of reactions) {
						const emojiObj = r.emoji ?? {};
						let symbol = emojiObj.unicode ?? "";
						if (!symbol) symbol = `:${emojiObj.customEmoji?.uid ?? "?"}:`;
						const count = r.reactionCount ?? 0;
						parts.push(`${symbol}x${count}`);
					}
					lines.push(`  [reactions: ${parts.join(", ")}]`);
				}

				lines.push(`  (Message ID: ${msgName})\n`);
			}

			if (data.nextPageToken) {
				lines.push(`Next page token: ${data.nextPageToken}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 3. send_message ───────────────────────────────────────────────────────
	server.tool(
		"send_message",
		"Send a text message to a Google Chat space. Supports thread replies via thread_name or thread_key.",
		{
			space_name: z
				.string()
				.describe(
					"Space resource name (e.g. 'spaces/AAAA'). Use list_spaces to find this.",
				),
			text: z.string().describe("Message text to send."),
			thread_name: z
				.string()
				.optional()
				.describe(
					"Reply in an existing thread by its resource name (e.g. 'spaces/X/threads/Y'). " +
						"Mutually exclusive with thread_key.",
				),
			thread_key: z
				.string()
				.optional()
				.describe(
					"Reply in a thread by app-defined key; creates a new thread if no match. " +
						"Mutually exclusive with thread_name.",
				),
		},
		async ({ space_name, text, thread_name, thread_key }) => {
			const { accessToken } = await ctx.getService("gchat");

			const messageBody: Record<string, unknown> = { text };
			const queryParams: Record<string, string | null | undefined> = {};

			if (thread_name) {
				messageBody.thread = { name: thread_name };
				queryParams.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
			} else if (thread_key) {
				messageBody.thread = { threadKey: thread_key };
				queryParams.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
			}

			const url = buildUrl(`${CHAT_BASE}/${space_name}/messages`, queryParams);
			const message = (await googleApiFetch(accessToken, url, {
				method: "POST",
				body: JSON.stringify(messageBody),
			})) as { name?: string; createTime?: string };

			const messageName = message.name ?? "";
			const createTime = message.createTime ?? "";

			return {
				content: [
					{
						type: "text" as const,
						text: `Message sent to space '${space_name}'. Message ID: ${messageName}, Time: ${createTime}`,
					},
				],
			};
		},
	);

	// ── 4. search_messages ────────────────────────────────────────────────────
	server.tool(
		"search_messages",
		"Search messages across Google Chat spaces by text content. Uses client-side filtering — the Chat API has no server-side full-text search.",
		{
			query: z.string().describe("Text to search for in message content."),
			space_types: z
				.enum(["all", "room", "dm"])
				.default("all")
				.describe('Restrict search to space type: "all", "room", or "dm".'),
			max_spaces: z
				.number()
				.int()
				.default(10)
				.describe("Maximum number of spaces to search (default 10)."),
		},
		async ({ query, space_types, max_spaces }) => {
			const { accessToken } = await ctx.getService("gchat");

			const spacesParams: Record<string, string | number | null | undefined> = {
				pageSize: 100,
			};
			if (space_types === "room") spacesParams.filter = "spaceType = SPACE";
			else if (space_types === "dm")
				spacesParams.filter = "spaceType = DIRECT_MESSAGE";

			const spacesData = (await googleApiFetch(
				accessToken,
				buildUrl(`${CHAT_BASE}/spaces`, spacesParams),
			)) as ChatSpacesListResponse;

			const spaces = (spacesData.spaces ?? []).slice(0, max_spaces);
			if (spaces.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No Chat spaces found to search (type: ${space_types}).`,
						},
					],
				};
			}

			// Fetch messages from each space sequentially (no cross-space API).
			const allMessages: ChatMessageWithSpace[] = [];
			let fetchErrors = 0;

			for (const space of spaces) {
				const spaceName = space.name ?? "";
				const spaceDisplay = space.displayName ?? spaceName;
				if (!spaceName) continue;
				try {
					const data = (await googleApiFetch(
						accessToken,
						buildUrl(`${CHAT_BASE}/${spaceName}/messages`, { pageSize: 25 }),
					)) as ChatMessagesListResponse;
					for (const msg of data.messages ?? []) {
						allMessages.push({ ...msg, _spaceName: spaceDisplay });
					}
				} catch {
					fetchErrors++;
				}
			}

			// Client-side text filtering (Chat API does not support text: filter).
			const queryLower = query.toLowerCase();
			const matched = allMessages.filter((m) =>
				(m.text ?? "").toLowerCase().includes(queryLower),
			);

			if (matched.length === 0) {
				const suffix =
					fetchErrors > 0
						? ` (${fetchErrors} space(s) skipped due to errors)`
						: "";
				return {
					content: [
						{
							type: "text" as const,
							text: `No messages found matching '${query}' in ${spaces.length} searched space(s)${suffix}.`,
						},
					],
				};
			}

			// Resolve unique senders.
			const senderKeys = new Map<
				string,
				{ name?: string; displayName?: string }
			>();
			for (const msg of matched) {
				const s = msg.sender ?? {};
				const key = s.name ?? "";
				if (key && !senderKeys.has(key)) senderKeys.set(key, s);
			}
			const senderMap = new Map<string, string>();
			for (const [key, senderObj] of senderKeys) {
				senderMap.set(key, await resolveSender(accessToken, senderObj));
			}

			const lines = [
				`Found ${matched.length} message(s) matching '${query}' across ${spaces.length} searched space(s):`,
			];
			for (const msg of matched) {
				const senderObj = msg.sender ?? {};
				const senderKey = senderObj.name ?? "";
				const sender =
					senderMap.get(senderKey) ??
					(await resolveSender(accessToken, senderObj));
				const createTime = msg.createTime ?? "Unknown Time";
				let textContent = msg.text ?? "No text content";
				if (textContent.length > 100)
					textContent = `${textContent.slice(0, 100)}...`;
				const spaceName = msg._spaceName;

				const richLinks = extractRichLinks(msg);
				const linksSuffix = richLinks
					.map((link) => ` [linked: ${link}]`)
					.join("");
				const attSuffix = (msg.attachment ?? [])
					.map(
						(a) =>
							` [attachment: ${a.contentName ?? "unnamed"} (${a.contentType ?? "unknown"})]`,
					)
					.join("");

				lines.push(
					`- [${createTime}] ${sender} in '${spaceName}': ${textContent}${linksSuffix}${attSuffix}`,
				);
			}

			if (fetchErrors > 0) {
				lines.push(`\n(${fetchErrors} space(s) skipped due to errors)`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 5. create_reaction ────────────────────────────────────────────────────
	server.tool(
		"create_reaction",
		"Add an emoji reaction to a Google Chat message.",
		{
			message_name: z
				.string()
				.describe(
					"Message resource name (e.g. 'spaces/AAAA/messages/BBBB'). Use get_messages to find this.",
				),
			emoji: z
				.string()
				.describe("Emoji character to react with (e.g. 👍 or 🎉)."),
		},
		async ({ message_name, emoji }) => {
			const { accessToken } = await ctx.getService("gchat");

			const reaction = (await googleApiFetch(
				accessToken,
				`${CHAT_BASE}/${message_name}/reactions`,
				{
					method: "POST",
					body: JSON.stringify({ emoji: { unicode: emoji } }),
				},
			)) as { name?: string };

			const reactionName = reaction.name ?? "";
			return {
				content: [
					{
						type: "text" as const,
						text: `Reacted with ${emoji} on message ${message_name}. Reaction ID: ${reactionName}`,
					},
				],
			};
		},
	);

	// ── 6. download_chat_attachment ───────────────────────────────────────────
	//
	// Best-effort implementation. The Python source saves to disk or returns a
	// temporary URL via transport-mode-aware attachment_storage. In Cloudflare
	// Workers there is no persistent file system and no built-in temp-URL service,
	// so we return metadata and base64-encoded content (capped at 256 KB preview
	// for large files). Register under attachment_resource_name rather than
	// attachment_index so callers can target a specific attachment directly.
	server.tool(
		"download_chat_attachment",
		"Download a Google Chat message attachment. Returns attachment metadata and base64-encoded content (capped at 256 KB for large files).",
		{
			space_name: z
				.string()
				.describe("Space resource name (e.g. 'spaces/AAAA')."),
			message_id: z
				.string()
				.describe(
					"Message resource name or bare message ID (e.g. 'spaces/AAAA/messages/BBBB' or 'BBBB'). " +
						"Use get_messages to find this.",
				),
			attachment_resource_name: z
				.string()
				.describe(
					"Attachment resource name from attachmentDataRef.resourceName " +
						"(e.g. 'spaces/AAAA/attachments/CCCC'). Shown by get_messages.",
				),
		},
		async ({ space_name, message_id, attachment_resource_name }) => {
			const { accessToken } = await ctx.getService("gchat");

			// Resolve full message resource name.
			const fullMessageName = message_id.startsWith("spaces/")
				? message_id
				: `${space_name}/messages/${message_id}`;

			// Fetch message metadata to get filename and content type.
			let fileName = "attachment";
			let contentType = "application/octet-stream";
			try {
				const msgData = (await googleApiFetch(
					accessToken,
					`${CHAT_BASE}/${fullMessageName}`,
				)) as ChatMessage;
				const att = (msgData.attachment ?? []).find(
					(a) =>
						a.attachmentDataRef?.resourceName === attachment_resource_name ||
						a.name === attachment_resource_name,
				);
				if (att) {
					fileName = att.contentName ?? fileName;
					contentType = att.contentType ?? contentType;
				}
			} catch {
				// Non-critical; continue with defaults.
			}

			// Download via Chat API media endpoint using fetch with Bearer token.
			// (googleApiFetch is not used here because the response is binary, not JSON.)
			const downloadUrl = `${CHAT_BASE}/media/${attachment_resource_name}?alt=media`;
			let resp: Response;
			try {
				resp = await fetch(downloadUrl, {
					headers: { Authorization: `Bearer ${accessToken}` },
				});
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to download attachment '${fileName}': ${String(err)}`,
						},
					],
				};
			}

			if (!resp.ok) {
				const body = await resp.text();
				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Failed to download attachment '${fileName}': HTTP ${resp.status} from media endpoint.`,
								body.slice(0, 500),
							].join("\n"),
						},
					],
				};
			}

			const buffer = await resp.arrayBuffer();
			const bytes = new Uint8Array(buffer);
			const sizeBytes = bytes.length;
			const sizeKb = (sizeBytes / 1024).toFixed(1);

			// Base64-encode up to 256 KB; truncate larger files with a preview.
			const MAX_B64_BYTES = 256 * 1024;
			const preview =
				bytes.length > MAX_B64_BYTES ? bytes.slice(0, MAX_B64_BYTES) : bytes;
			let binary = "";
			for (let i = 0; i < preview.length; i++) {
				binary += String.fromCharCode(preview[i]);
			}
			const base64Content = btoa(binary);
			const truncated = bytes.length > MAX_B64_BYTES;

			const lines = [
				`Attachment downloaded: ${fileName}`,
				`Type: ${contentType}`,
				`Size: ${sizeKb} KB (${sizeBytes} bytes)`,
				"",
				"Note: Cloudflare Workers runtime has no file storage or temp-URL service.",
				"Content is returned as base64-encoded data below.",
				truncated
					? `(File exceeds 256 KB preview cap — showing first ${MAX_B64_BYTES} bytes of ${sizeBytes})`
					: "",
				"",
				`Content-Type: ${contentType}`,
				`Base64 (${base64Content.length} chars):`,
				base64Content,
			].filter((l) => l !== undefined);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
