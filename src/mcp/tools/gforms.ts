// Google Forms tools — 6 tools for the `gforms` service.
//
// Module pattern (same for all 12 service modules):
//   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//   import { z } from "zod";
//   import { googleApiFetch, type ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// Shared authenticated fetch lives in google-service.ts as googleApiFetch().
// Google Forms REST API base: https://forms.googleapis.com/v1

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URL ──────────────────────────────────────────────────────────────

const FORMS_BASE = "https://forms.googleapis.com/v1";

// ─── Authenticated fetch helper ────────────────────────────────────────────────

const formsFetch = googleApiFetch;

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

interface ChoiceOption {
	value?: string;
	isOther?: boolean;
	goToAction?: string;
	goToSectionId?: string;
}

interface ChoiceQuestion {
	type?: string;
	options?: ChoiceOption[];
}

interface TextQuestion {
	paragraph?: boolean;
}

interface RowQuestion {
	title?: string;
}

interface FormQuestion {
	questionId?: string;
	required?: boolean;
	choiceQuestion?: ChoiceQuestion;
	textQuestion?: TextQuestion;
	rowQuestion?: RowQuestion;
	scaleQuestion?: Record<string, unknown>;
	dateQuestion?: Record<string, unknown>;
	timeQuestion?: Record<string, unknown>;
	fileUploadQuestion?: Record<string, unknown>;
	ratingQuestion?: Record<string, unknown>;
}

interface GridRow {
	questionId?: string;
	required?: boolean;
	rowQuestion?: RowQuestion;
}

interface QuestionGroupItem {
	questions?: GridRow[];
	grid?: {
		columns?: {
			options?: ChoiceOption[];
		};
	};
}

interface FormItem {
	itemId?: string;
	title?: string;
	description?: string;
	questionItem?: { question?: FormQuestion };
	questionGroupItem?: QuestionGroupItem;
	pageBreakItem?: Record<string, unknown>;
	textItem?: Record<string, unknown>;
	imageItem?: Record<string, unknown>;
	videoItem?: Record<string, unknown>;
}

interface FormInfo {
	title?: string;
	description?: string;
	documentTitle?: string;
}

interface FormRecord {
	formId?: string;
	info?: FormInfo;
	responderUri?: string;
	items?: FormItem[];
}

interface TextAnswer {
	value?: string;
}

interface FormAnswer {
	textAnswers?: { answers?: TextAnswer[] };
}

interface FormResponseRecord {
	responseId?: string;
	createTime?: string;
	lastSubmittedTime?: string;
	answers?: Record<string, FormAnswer>;
}

interface ListFormResponsesResult {
	responses?: FormResponseRecord[];
	nextPageToken?: string;
}

interface CreateItemReply {
	itemId?: string;
	questionId?: string[];
}

interface BatchReply {
	createItem?: CreateItemReply;
}

interface BatchUpdateResult {
	replies?: BatchReply[];
}

// ─── Serialized item shape ─────────────────────────────────────────────────────

interface SerializedItem {
	index: number;
	itemId?: string;
	title: string;
	description?: string;
	type?: string;
	required?: boolean;
	questionId?: string;
	options?: ChoiceOption[];
	grid?: {
		rows: Array<{ title: string; questionId?: string; required: boolean }>;
		columns: ChoiceOption[];
	};
}

// ─── Form helpers ──────────────────────────────────────────────────────────────

/** Filter out options without a truthy value (mirrors Python _extract_option_values). */
function extractOptionValues(options: ChoiceOption[]): ChoiceOption[] {
	return options.filter((opt) => !!opt.value);
}

/** Map a Forms question payload to a stable type label (mirrors Python _get_question_type). */
function getQuestionType(question: FormQuestion): string {
	if (question.choiceQuestion) {
		return question.choiceQuestion.type ?? "CHOICE";
	}
	if (question.textQuestion) {
		return question.textQuestion.paragraph ? "PARAGRAPH" : "TEXT";
	}
	if (question.rowQuestion !== undefined) return "GRID_ROW";
	if (question.scaleQuestion !== undefined) return "SCALE";
	if (question.dateQuestion !== undefined) return "DATE";
	if (question.timeQuestion !== undefined) return "TIME";
	if (question.fileUploadQuestion !== undefined) return "FILE_UPLOAD";
	if (question.ratingQuestion !== undefined) return "RATING";
	return "QUESTION";
}

/**
 * Serialize a Forms item with the key metadata agents need for edits.
 * Mirrors Python _serialize_form_item — handles questionItem, questionGroupItem,
 * pageBreakItem, textItem, imageItem, videoItem.
 */
function serializeFormItem(item: FormItem, index: number): SerializedItem {
	const serialized: SerializedItem = {
		index,
		itemId: item.itemId,
		title: item.title ?? `Question ${index}`,
	};

	if (item.description) {
		serialized.description = item.description;
	}

	if (item.questionItem !== undefined) {
		const question: FormQuestion = item.questionItem.question ?? {};
		serialized.type = getQuestionType(question);
		serialized.required = question.required ?? false;
		if (question.questionId) {
			serialized.questionId = question.questionId;
		}
		if (question.choiceQuestion) {
			serialized.options = extractOptionValues(
				question.choiceQuestion.options ?? [],
			);
		}
		return serialized;
	}

	if (item.questionGroupItem !== undefined) {
		const qg = item.questionGroupItem;
		const columns = extractOptionValues(qg.grid?.columns?.options ?? []);
		const rows = (qg.questions ?? []).map((q) => {
			const row: { title: string; questionId?: string; required: boolean } = {
				title: q.rowQuestion?.title ?? "",
				required: q.required ?? false,
			};
			if (q.questionId) row.questionId = q.questionId;
			return row;
		});
		serialized.type = "GRID";
		serialized.grid = { rows, columns };
		return serialized;
	}

	if (item.pageBreakItem !== undefined) {
		serialized.type = "PAGE_BREAK";
	} else if (item.textItem !== undefined) {
		serialized.type = "TEXT_ITEM";
	} else if (item.imageItem !== undefined) {
		serialized.type = "IMAGE";
	} else if (item.videoItem !== undefined) {
		serialized.type = "VIDEO";
	} else {
		serialized.type = "UNKNOWN";
	}

	return serialized;
}

// ─── Tool registration ─────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. create_form ─────────────────────────────────────────────────────────
	server.tool(
		"create_form",
		"Create a new Google Form.",
		{
			title: z.string().describe("Title of the form."),
			description: z.string().optional().describe("Description of the form."),
			document_title: z
				.string()
				.optional()
				.describe("Document title shown in the browser tab."),
		},
		async ({ title, description, document_title }) => {
			const { accessToken } = await ctx.getService("gforms");

			const info: Record<string, string> = { title };
			if (description) info.description = description;
			// Send as camelCase per Forms REST API spec (Python source uses snake_case
			// which googleapiclient passes through — our direct REST call needs camelCase).
			if (document_title) info.documentTitle = document_title;

			const created = (await formsFetch(accessToken, `${FORMS_BASE}/forms`, {
				method: "POST",
				body: JSON.stringify({ info }),
			})) as FormRecord;

			const formId = created.formId ?? "N/A";
			const editUrl = `https://docs.google.com/forms/d/${formId}/edit`;
			const responderUrl =
				created.responderUri ??
				`https://docs.google.com/forms/d/${formId}/viewform`;
			const formTitle = created.info?.title ?? title;

			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully created form '${formTitle}'. Form ID: ${formId}. Edit URL: ${editUrl}. Responder URL: ${responderUrl}`,
					},
				],
			};
		},
	);

	// ── 2. get_form ────────────────────────────────────────────────────────────
	server.tool(
		"get_form",
		"Get a Google Form's structure and all its items.",
		{
			form_id: z.string().describe("The ID of the form to retrieve."),
		},
		async ({ form_id }) => {
			const { accessToken } = await ctx.getService("gforms");

			const form = (await formsFetch(
				accessToken,
				`${FORMS_BASE}/forms/${encodeURIComponent(form_id)}`,
			)) as FormRecord;

			const formInfo = form.info ?? {};
			const title = formInfo.title ?? "No Title";
			const description = formInfo.description ?? "No Description";
			const documentTitle = formInfo.documentTitle ?? title;

			const editUrl = `https://docs.google.com/forms/d/${form_id}/edit`;
			const responderUrl =
				form.responderUri ??
				`https://docs.google.com/forms/d/${form_id}/viewform`;

			const items = form.items ?? [];
			const serializedItems = items.map((item, i) =>
				serializeFormItem(item, i + 1),
			);

			const itemsSummary =
				serializedItems
					.map((si) => {
						const reqText = si.required ? " (Required)" : "";
						return `  ${si.index}. ${si.title} [${si.type ?? "UNKNOWN"}]${reqText}`;
					})
					.join("\n") || "  No items found";

			const itemsJson =
				serializedItems.length > 0
					? JSON.stringify(serializedItems, null, 2)
					: "[]";

			const text = [
				"Form Details:",
				`- Title: "${title}"`,
				`- Description: "${description}"`,
				`- Document Title: "${documentTitle}"`,
				`- Form ID: ${form_id}`,
				`- Edit URL: ${editUrl}`,
				`- Responder URL: ${responderUrl}`,
				`- Items (${items.length} total):`,
				itemsSummary,
				"- Items (structured):",
				itemsJson,
			].join("\n");

			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 3. set_publish_settings ────────────────────────────────────────────────
	server.tool(
		"set_publish_settings",
		"Publish or unpublish a Google Form, or toggle whether it accepts responses.",
		{
			form_id: z.string().describe("The ID of the form."),
			is_published: z
				.boolean()
				.default(true)
				.describe("Whether the form is published and visible to responders."),
			is_accepting_responses: z
				.boolean()
				.default(true)
				.describe(
					"Whether the form accepts responses. Takes effect only when the form is published.",
				),
		},
		async ({ form_id, is_published, is_accepting_responses }) => {
			const { accessToken } = await ctx.getService("gforms");

			await formsFetch(
				accessToken,
				`${FORMS_BASE}/forms/${encodeURIComponent(form_id)}:setPublishSettings`,
				{
					method: "POST",
					body: JSON.stringify({
						publishSettings: {
							publishState: {
								isPublished: is_published,
								isAcceptingResponses: is_accepting_responses,
							},
						},
						updateMask: "publishState",
					}),
				},
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully updated publish settings for form ${form_id}. Published: ${is_published}, Accepting responses: ${is_accepting_responses}`,
					},
				],
			};
		},
	);

	// ── 4. get_form_response ───────────────────────────────────────────────────
	server.tool(
		"get_form_response",
		"Get a single response from a Google Form.",
		{
			form_id: z.string().describe("The ID of the form."),
			response_id: z.string().describe("The ID of the response to retrieve."),
		},
		async ({ form_id, response_id }) => {
			const { accessToken } = await ctx.getService("gforms");

			const response = (await formsFetch(
				accessToken,
				`${FORMS_BASE}/forms/${encodeURIComponent(form_id)}/responses/${encodeURIComponent(response_id)}`,
			)) as FormResponseRecord;

			const responseId = response.responseId ?? "Unknown";
			const createTime = response.createTime ?? "Unknown";
			const lastSubmittedTime = response.lastSubmittedTime ?? "Unknown";

			const answers = response.answers ?? {};
			const answerDetails = Object.entries(answers).map(
				([questionId, answerData]) => {
					const answerValues = answerData.textAnswers?.answers ?? [];
					if (answerValues.length > 0) {
						const answerText = answerValues
							.map((a) => a.value ?? "")
							.join(", ");
						return `  Question ID ${questionId}: ${answerText}`;
					}
					return `  Question ID ${questionId}: No answer provided`;
				},
			);

			const answersText =
				answerDetails.length > 0
					? answerDetails.join("\n")
					: "  No answers found";

			const text = [
				"Form Response Details:",
				`- Form ID: ${form_id}`,
				`- Response ID: ${responseId}`,
				`- Created: ${createTime}`,
				`- Last Submitted: ${lastSubmittedTime}`,
				"- Answers:",
				answersText,
			].join("\n");

			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 5. list_form_responses ─────────────────────────────────────────────────
	server.tool(
		"list_form_responses",
		"List responses for a Google Form with pagination support.",
		{
			form_id: z.string().describe("The ID of the form."),
			page_size: z
				.number()
				.int()
				.default(10)
				.describe("Maximum number of responses to return (default 10)."),
			page_token: z
				.string()
				.optional()
				.describe("Token for retrieving the next page of results."),
		},
		async ({ form_id, page_size, page_token }) => {
			const { accessToken } = await ctx.getService("gforms");

			const url = buildUrl(
				`${FORMS_BASE}/forms/${encodeURIComponent(form_id)}/responses`,
				{ pageSize: page_size, pageToken: page_token },
			);

			const result = (await formsFetch(
				accessToken,
				url,
			)) as ListFormResponsesResult;

			const responses = result.responses ?? [];
			const nextPageToken = result.nextPageToken;

			if (responses.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No responses found for form ${form_id}.`,
						},
					],
				};
			}

			const responseLines = responses.map((r, i) => {
				const rId = r.responseId ?? "Unknown";
				const cTime = r.createTime ?? "Unknown";
				const lsTime = r.lastSubmittedTime ?? "Unknown";
				const ansCount = Object.keys(r.answers ?? {}).length;
				return (
					`  ${i + 1}. Response ID: ${rId} | Created: ${cTime} | ` +
					`Last Submitted: ${lsTime} | Answers: ${ansCount}`
				);
			});

			const paginationInfo = nextPageToken
				? `\nNext page token: ${nextPageToken}`
				: "\nNo more pages.";

			const text =
				[
					"Form Responses:",
					`- Form ID: ${form_id}`,
					`- Total responses returned: ${responses.length}`,
					"- Responses:",
					...responseLines,
				].join("\n") + paginationInfo;

			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 6. batch_update_form ───────────────────────────────────────────────────
	server.tool(
		"batch_update_form",
		"Apply batch updates to a Google Form. Supports createItem, updateItem, deleteItem, moveItem, updateFormInfo, and updateSettings request types.",
		{
			form_id: z.string().describe("The ID of the form to update."),
			requests: z
				.array(z.record(z.string(), z.unknown()))
				.describe(
					"List of update requests. Supported types: createItem, updateItem, deleteItem, moveItem, updateFormInfo, updateSettings.",
				),
		},
		async ({ form_id, requests }) => {
			const { accessToken } = await ctx.getService("gforms");

			const result = (await formsFetch(
				accessToken,
				`${FORMS_BASE}/forms/${encodeURIComponent(form_id)}:batchUpdate`,
				{
					method: "POST",
					body: JSON.stringify({ requests }),
				},
			)) as BatchUpdateResult;

			const replies = result.replies ?? [];

			const lines = [
				"Batch Update Completed:",
				`- Form ID: ${form_id}`,
				`- URL: https://docs.google.com/forms/d/${form_id}/edit`,
				`- Requests Applied: ${requests.length}`,
				`- Replies Received: ${replies.length}`,
			];

			if (replies.length > 0) {
				lines.push("\nUpdate Results:");
				for (let i = 0; i < replies.length; i++) {
					const reply = replies[i];
					if (reply.createItem) {
						const itemId = reply.createItem.itemId ?? "Unknown";
						const questionIds = reply.createItem.questionId ?? [];
						const qInfo =
							questionIds.length > 0
								? ` (Question IDs: ${questionIds.join(", ")})`
								: "";
						lines.push(`  Request ${i + 1}: Created item ${itemId}${qInfo}`);
					} else {
						lines.push(`  Request ${i + 1}: Operation completed`);
					}
				}
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
