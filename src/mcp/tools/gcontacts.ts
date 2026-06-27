// Google Contacts tools — 8 tools for the `gcontacts` service.
// People API base: https://people.googleapis.com/v1
//
// Module pattern — mirrors gcalendar.ts exactly:
//   export function register(server: McpServer, ctx: ToolContext): void { ... }

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";
import {
	type AddressEntry,
	type BirthdayEntry,
	type EmailEntry,
	formatContact,
	mergeEmails,
	mergeNicknames,
	mergeOrganizations,
	mergePhones,
	mergeRelations,
	mergeUrls,
	mergeUserDefined,
	type NicknameEntry,
	type OrgEntry,
	type PersonResponse,
	type PhoneEntry,
	parseBirthday,
	type RelationEntry,
	type UrlEntry,
	type UserDefinedEntry,
} from "./gcontacts-helpers";

// ─── API base URL ──────────────────────────────────────────────────────────────

const PEOPLE_BASE = "https://people.googleapis.com/v1";

// ─── Field masks ──────────────────────────────────────────────────────────────

/** Fields returned for list/search operations. */
const DEFAULT_PERSON_FIELDS =
	"names,nicknames,emailAddresses,phoneNumbers,organizations";

/** Fields returned for get/create/update operations (full detail). */
const DETAILED_PERSON_FIELDS =
	"names,nicknames,emailAddresses,phoneNumbers,organizations,biographies," +
	"addresses,birthdays,urls,userDefined,relations,photos,metadata,memberships";

/** Fields returned for contact group list/get operations. */
const CONTACT_GROUP_FIELDS = "name,groupType,memberCount,metadata";

// ─── Authenticated fetch helper ────────────────────────────────────────────────

const peopleFetch = googleApiFetch;

// ─── URL builders ─────────────────────────────────────────────────────────────

/** Build a URL appending non-null/undefined params as query string. */
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

/**
 * Build a People API batchGet URL.
 * `resourceNames` is a repeated query parameter — must use .append(), not .set().
 */
function buildBatchGetUrl(
	resourceNames: string[],
	personFields: string,
): string {
	const url = new URL(`${PEOPLE_BASE}/people:batchGet`);
	for (const rn of resourceNames) {
		url.searchParams.append("resourceNames", rn);
	}
	url.searchParams.set("personFields", personFields);
	return url.toString();
}

// ─── Response types ────────────────────────────────────────────────────────────

interface ConnectionsListResponse {
	connections?: PersonResponse[];
	nextPageToken?: string;
	totalPeople?: number;
}

interface SearchContactsResponse {
	results?: Array<{ person?: PersonResponse }>;
}

interface BatchGetResponse {
	responses?: Array<{ person?: PersonResponse }>;
}

interface BatchCreateResponse {
	createdPeople?: Array<{ person?: PersonResponse }>;
}

interface BatchUpdateResponse {
	updateResult?: Record<string, { person?: PersonResponse }>;
}

interface ContactGroupResponse {
	resourceName?: string;
	name?: string;
	groupType?: string;
	memberCount?: number;
	memberResourceNames?: string[];
}

interface ContactGroupsListResponse {
	contactGroups?: ContactGroupResponse[];
	nextPageToken?: string;
}

interface ModifyMembersResponse {
	notFoundResourceNames?: string[];
	canNotRemoveLastContactGroupResourceNames?: string[];
}

// ─── Person resource body (for create/update) ─────────────────────────────────
//
// Uses the same entry types as PersonResponse so merge helpers are compatible.

interface PersonBody {
	names?: Array<{ givenName: string; familyName: string }>;
	emailAddresses?: EmailEntry[];
	phoneNumbers?: PhoneEntry[];
	organizations?: OrgEntry[];
	nicknames?: NicknameEntry[];
	urls?: UrlEntry[];
	userDefined?: UserDefinedEntry[];
	relations?: RelationEntry[];
	biographies?: Array<{ value: string; contentType: string }>;
	addresses?: AddressEntry[];
	birthdays?: BirthdayEntry[];
	etag?: string;
}

// ─── Zod input schemas ─────────────────────────────────────────────────────────

// ─── Input preprocessing helpers ──────────────────────────────────────────────
//
// Mirror the Python _coerce_* functions:
//   - phone/email: map `label` → `type` when `type` is absent.
//   - nickname/url: accept a bare string and wrap as {value:str}.
//   - relation: accept a bare string and wrap as {person:str}.
//   - organization: accept `description` as alias for `jobDescription`.

function coerceLabelToType(v: unknown): unknown {
	if (v && typeof v === "object" && !Array.isArray(v)) {
		const obj = v as Record<string, unknown>;
		if (!obj.type && obj.label) {
			const { label, ...rest } = obj;
			return { ...rest, type: label };
		}
	}
	return v;
}

const PhoneInputSchema = z.preprocess(
	coerceLabelToType,
	z.object({
		number: z.string().optional().describe("Phone number value."),
		value: z
			.string()
			.optional()
			.describe("Backward-compatible alias for the phone number value."),
		type: z
			.string()
			.optional()
			.describe(
				"Phone type: mobile, work, home, main, workMobile, internal, other, etc.",
			),
	}),
);

const EmailInputSchema = z.preprocess(
	coerceLabelToType,
	z.object({
		address: z.string().optional().describe("Email address value."),
		value: z
			.string()
			.optional()
			.describe("Backward-compatible alias for the email address value."),
		type: z.string().optional().describe("Email type: work, home, or other."),
	}),
);

const OrganizationInputSchema = z.preprocess(
	(v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const obj = v as Record<string, unknown>;
			if (obj.description !== undefined && obj.jobDescription === undefined) {
				const { description, ...rest } = obj;
				return { ...rest, jobDescription: description };
			}
		}
		return v;
	},
	z.object({
		name: z.string().optional().describe("Organization name."),
		title: z.string().optional().describe("Job title."),
		department: z.string().optional().describe("Department name."),
		jobDescription: z
			.string()
			.optional()
			.describe("Optional organization job description. Alias: 'description'."),
		type: z.string().optional().describe("Organization type: work or school."),
	}),
);

const NicknameInputSchema = z.preprocess(
	(v) => (typeof v === "string" ? { value: v } : v),
	z.object({
		value: z
			.string()
			.describe(
				"Nickname value. Useful for bilingual contacts (e.g. Hebrew/English alternative forms).",
			),
		type: z
			.string()
			.optional()
			.describe(
				"Nickname type: default, alternate_name, maiden_name, initials, or other.",
			),
	}),
);

const UrlInputSchema = z.preprocess(
	(v) => (typeof v === "string" ? { value: v } : v),
	z.object({
		value: z.string().describe("The URL value (e.g. https://example.com)."),
		type: z
			.string()
			.optional()
			.describe(
				"URL type: homepage, blog, profile, work, ftp, reservations, or other.",
			),
	}),
);

const UserDefinedInputSchema = z.object({
	key: z
		.string()
		.describe(
			"Custom field key (e.g. 'ID', 'Hebrew Birthday', 'Account Number').",
		),
	value: z
		.string()
		.default("")
		.describe("Custom field value. May be omitted when using remove mode."),
});

const RelationInputSchema = z.preprocess(
	(v) => (typeof v === "string" ? { person: v } : v),
	z.object({
		person: z.string().describe("The related person's name."),
		type: z
			.string()
			.optional()
			.describe(
				"Relation type: spouse, child, parent, father, mother, sister, brother, " +
					"friend, manager, assistant, partner, sibling, domesticPartner, or custom.",
			),
	}),
);

const MergeModeSchema = z
	.enum(["merge", "replace", "remove"])
	.default("merge")
	.describe('"merge" (default), "replace", or "remove".');

const StringListSchema = z.union([z.string(), z.array(z.string())]);

/** Parse a StringList (comma-separated string or string array) into string[]. */
function toStringArray(input: string | string[]): string[] {
	if (typeof input === "string") {
		return input
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return input;
}

// ─── ContactInput schemas (for batch operations) ───────────────────────────────

const ContactInputSchema = z.object({
	given_name: z.string().optional().describe("First name."),
	family_name: z.string().optional().describe("Last name."),
	phones: z.array(PhoneInputSchema).optional(),
	emails: z.array(EmailInputSchema).optional(),
	organizations: z.array(OrganizationInputSchema).optional(),
	nicknames: z.array(NicknameInputSchema).optional(),
	urls: z.array(UrlInputSchema).optional(),
	user_defined: z.array(UserDefinedInputSchema).optional(),
	relations: z.array(RelationInputSchema).optional(),
	notes: z.string().optional().describe("Notes/biography."),
	address: z.string().optional().describe("Street address."),
	birthday: z
		.string()
		.optional()
		.describe("Birthday as 'YYYY-MM-DD', 'MM-DD', or 'clear' to remove."),
	// Deprecated single-value aliases
	phone: z
		.string()
		.optional()
		.describe("[Deprecated] Single phone number. Use phones instead."),
	email: z
		.string()
		.optional()
		.describe("[Deprecated] Email address. Use emails instead."),
	organization: z
		.string()
		.optional()
		.describe("[Deprecated] Company name. Use organizations instead."),
	job_title: z
		.string()
		.optional()
		.describe("[Deprecated] Job title. Use organizations instead."),
});

const ContactUpdateInputSchema = ContactInputSchema.extend({
	contact_id: z
		.string()
		.describe(
			'Contact ID like "c123" or full resource name like "people/c123".',
		),
});

type ContactInput = z.infer<typeof ContactInputSchema>;
type ContactUpdateInput = z.infer<typeof ContactUpdateInputSchema>;

// ─── Search cache warmup ───────────────────────────────────────────────────────
//
// The People API requires an initial empty query per account to prime the search
// cache — the index is built lazily PER ACCOUNT and the empty-query warmup is
// load-bearing (searches won't return results until warmed).  Track which
// accounts have been warmed in a Set so that one account's warmup never
// suppresses warmup for another account (mirrors the Python Dict[str, bool]).

const _searchCacheWarmedAccounts = new Set<string>();

async function warmupSearchCache(
	accessToken: string,
	accountEmail: string,
): Promise<void> {
	if (_searchCacheWarmedAccounts.has(accountEmail)) return;
	try {
		await peopleFetch(
			accessToken,
			buildUrl(`${PEOPLE_BASE}/people:searchContacts`, {
				query: "",
				readMask: "names",
				pageSize: 1,
			}),
		);
		_searchCacheWarmedAccounts.add(accountEmail);
	} catch {
		// Non-fatal — search may still work without warmup.
	}
}

// ─── Person body builder ───────────────────────────────────────────────────────

/**
 * Build a People API Person resource body from user-supplied params.
 *
 * Handles deprecated single-value aliases (phone, email, organization, job_title)
 * as fallbacks when the list-based params are absent.
 *
 * Notes tri-state: undefined = no change; "" = clear (biographies: []); text = set.
 * Birthday tri-state: undefined = no change; "clear"/"" = remove; else parse.
 */
function buildPersonBody(params: {
	given_name?: string;
	family_name?: string;
	phones?: Array<{ number?: string; value?: string; type?: string }>;
	emails?: Array<{ address?: string; value?: string; type?: string }>;
	organizations?: Array<{
		name?: string;
		title?: string;
		department?: string;
		jobDescription?: string;
		type?: string;
	}>;
	nicknames?: Array<{ value: string; type?: string }>;
	urls?: Array<{ value: string; type?: string }>;
	user_defined?: Array<{ key: string; value?: string }>;
	relations?: Array<{ person: string; type?: string }>;
	notes?: string;
	address?: string;
	birthday?: string;
	phone?: string;
	email?: string;
	organization?: string;
	job_title?: string;
}): PersonBody {
	const body: PersonBody = {};

	// Names
	if (params.given_name || params.family_name) {
		body.names = [
			{
				givenName: params.given_name ?? "",
				familyName: params.family_name ?? "",
			},
		];
	}

	// Emails (deprecated `email` fallback)
	const effectiveEmails =
		params.emails ??
		(params.email !== undefined
			? [{ address: params.email, type: "other" }]
			: undefined);

	if (effectiveEmails !== undefined) {
		const entries: EmailEntry[] = [];
		for (const e of effectiveEmails) {
			const addr = e.address ?? e.value ?? "";
			if (!addr) continue;
			const entry: EmailEntry = { value: addr };
			if (e.type) entry.type = e.type;
			entries.push(entry);
		}
		body.emailAddresses = entries;
	}

	// Phones (deprecated `phone` fallback)
	const effectivePhones =
		params.phones ??
		(params.phone !== undefined
			? [{ number: params.phone, type: "mobile" }]
			: undefined);

	if (effectivePhones !== undefined) {
		const entries: PhoneEntry[] = [];
		for (const p of effectivePhones) {
			const number = p.number ?? p.value ?? "";
			if (!number) continue;
			const entry: PhoneEntry = { value: number };
			if (p.type) entry.type = p.type;
			entries.push(entry);
		}
		body.phoneNumbers = entries;
	}

	// Organizations (deprecated `organization`/`job_title` fallback)
	const effectiveOrgs =
		params.organizations ??
		(params.organization !== undefined || params.job_title !== undefined
			? [{ name: params.organization, title: params.job_title }]
			: undefined);

	if (effectiveOrgs !== undefined) {
		const entries: OrgEntry[] = [];
		for (const org of effectiveOrgs) {
			const entry: OrgEntry = {};
			if (org.name) entry.name = org.name;
			if (org.title) entry.title = org.title;
			if (org.department) entry.department = org.department;
			if (org.jobDescription) entry.jobDescription = org.jobDescription;
			if (org.type) entry.type = org.type;
			if (Object.keys(entry).length > 0) entries.push(entry);
		}
		body.organizations = entries;
	}

	// Nicknames
	if (params.nicknames !== undefined) {
		const entries: NicknameEntry[] = [];
		for (const n of params.nicknames) {
			const value = (n.value ?? "").trim();
			if (!value) continue;
			const entry: NicknameEntry = { value };
			if (n.type) entry.type = n.type;
			entries.push(entry);
		}
		body.nicknames = entries;
	}

	// URLs
	if (params.urls !== undefined) {
		const entries: UrlEntry[] = [];
		for (const u of params.urls) {
			const value = (u.value ?? "").trim();
			if (!value) continue;
			const entry: UrlEntry = { value };
			if (u.type) entry.type = u.type;
			entries.push(entry);
		}
		body.urls = entries;
	}

	// User-defined custom fields
	if (params.user_defined !== undefined) {
		const entries: UserDefinedEntry[] = [];
		for (const ud of params.user_defined) {
			const key = (ud.key ?? "").trim();
			if (!key) continue;
			const value = (ud.value ?? "").trim();
			const entry: UserDefinedEntry = { key };
			if (value) entry.value = value;
			entries.push(entry);
		}
		body.userDefined = entries;
	}

	// Relations
	if (params.relations !== undefined) {
		const entries: RelationEntry[] = [];
		for (const r of params.relations) {
			const person = (r.person ?? "").trim();
			if (!person) continue;
			const entry: RelationEntry = { person };
			if (r.type) entry.type = r.type;
			entries.push(entry);
		}
		body.relations = entries;
	}

	// Notes: undefined → skip; "" → clear; text → set
	if (params.notes !== undefined) {
		if (params.notes) {
			body.biographies = [{ value: params.notes, contentType: "TEXT_PLAIN" }];
		} else {
			body.biographies = [];
		}
	}

	// Address
	if (params.address) {
		body.addresses = [{ formattedValue: params.address }];
	}

	// Birthday: undefined → skip; "clear"/"" → remove; else parse
	if (params.birthday !== undefined) {
		const trimmed = params.birthday.trim();
		if (trimmed.toLowerCase() === "clear" || trimmed === "") {
			body.birthdays = [];
		} else {
			body.birthdays = [parseBirthday(trimmed)];
		}
	}

	return body;
}

// ─── Tool registration ─────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_contacts ──────────────────────────────────────────────────────
	server.tool(
		"list_contacts",
		"List contacts for the connected Google account.",
		{
			page_size: z
				.number()
				.int()
				.default(100)
				.describe(
					"Maximum number of contacts to return (default: 100, max: 1000).",
				),
			page_token: z.string().optional().describe("Token for pagination."),
			sort_order: z
				.enum([
					"LAST_MODIFIED_ASCENDING",
					"LAST_MODIFIED_DESCENDING",
					"FIRST_NAME_ASCENDING",
					"LAST_NAME_ASCENDING",
				])
				.optional()
				.describe("Sort order for the results."),
		},
		async ({ page_size, page_token, sort_order }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");
			const effectivePageSize = Math.min(Math.max(page_size, 1), 1000);

			const url = buildUrl(`${PEOPLE_BASE}/people/me/connections`, {
				personFields: DEFAULT_PERSON_FIELDS,
				pageSize: effectivePageSize,
				pageToken: page_token,
				sortOrder: sort_order,
			});

			const result = (await peopleFetch(
				accessToken,
				url,
			)) as ConnectionsListResponse;
			const connections = result.connections ?? [];
			const nextPageToken = result.nextPageToken;
			const totalPeople = result.totalPeople ?? connections.length;

			if (connections.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No contacts found for ${accountEmail}.`,
						},
					],
				};
			}

			const lines = [
				`Contacts for ${accountEmail} (${connections.length} of ${totalPeople}):\n`,
			];
			for (const person of connections) {
				lines.push(`${formatContact(person)}\n`);
			}
			if (nextPageToken) {
				lines.push(`Next page token: ${nextPageToken}`);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 2. get_contact ────────────────────────────────────────────────────────
	server.tool(
		"get_contact",
		"Get detailed information about a specific contact.",
		{
			contact_id: z
				.string()
				.describe(
					'Contact ID (e.g. "c1234567890") or full resource name (e.g. "people/c1234567890").',
				),
		},
		async ({ contact_id }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");
			const resourceName = contact_id.startsWith("people/")
				? contact_id
				: `people/${contact_id}`;

			const url = buildUrl(`${PEOPLE_BASE}/${resourceName}`, {
				personFields: DETAILED_PERSON_FIELDS,
			});

			const person = (await peopleFetch(accessToken, url)) as PersonResponse;

			const text = `Contact Details for ${accountEmail}:\n\n${formatContact(person, true)}`;
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 3. search_contacts ────────────────────────────────────────────────────
	server.tool(
		"search_contacts",
		"Search contacts by name, email, phone number, or other fields.",
		{
			query: z
				.string()
				.describe(
					"Search query (searches names, email addresses, phone numbers).",
				),
			page_size: z
				.number()
				.int()
				.default(30)
				.describe(
					"Maximum number of results to return (default: 30, max: 30).",
				),
		},
		async ({ query, page_size }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");
			const effectivePageSize = Math.min(Math.max(page_size, 1), 30);

			// The People API requires a per-account warmup call before searches return results.
			await warmupSearchCache(accessToken, accountEmail);

			const url = buildUrl(`${PEOPLE_BASE}/people:searchContacts`, {
				query,
				readMask: DEFAULT_PERSON_FIELDS,
				pageSize: effectivePageSize,
			});

			const result = (await peopleFetch(
				accessToken,
				url,
			)) as SearchContactsResponse;
			const results = result.results ?? [];

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No contacts found matching '${query}' for ${accountEmail}.`,
						},
					],
				};
			}

			const lines = [
				`Search Results for '${query}' (${results.length} found):\n`,
			];
			for (const item of results) {
				if (item.person) lines.push(`${formatContact(item.person)}\n`);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 4. manage_contact ─────────────────────────────────────────────────────
	server.tool(
		"manage_contact",
		"Create, update, or delete a contact. " +
			"Update uses read-modify-write with per-field merge modes (merge/replace/remove).",
		{
			action: z
				.enum(["create", "update", "delete"])
				.describe('Action to perform: "create", "update", or "delete".'),
			contact_id: z
				.string()
				.optional()
				.describe(
					'Contact ID like "c123" or full resource name "people/c123". ' +
						"Required for update and delete.",
				),
			given_name: z.string().optional().describe("First name."),
			family_name: z.string().optional().describe("Last name."),
			phones: z
				.array(PhoneInputSchema)
				.optional()
				.describe(
					"List of phone entries {number, type?}. " +
						"Types: mobile, work, home, main, workMobile, internal, other, etc.",
				),
			emails: z
				.array(EmailInputSchema)
				.optional()
				.describe(
					"List of email entries {address, type?}. Types: work, home, other.",
				),
			organizations: z
				.array(OrganizationInputSchema)
				.optional()
				.describe(
					"List of organization entries {name?, title?, department?, jobDescription?, type?}.",
				),
			nicknames: z
				.array(NicknameInputSchema)
				.optional()
				.describe(
					"List of nickname entries {value, type?}. " +
						"Useful for bilingual contacts. " +
						"Types: default, alternate_name, maiden_name, initials, other.",
				),
			urls: z
				.array(UrlInputSchema)
				.optional()
				.describe(
					"List of URL entries {value, type?}. " +
						"Types: homepage, blog, profile, work, ftp, reservations, other.",
				),
			user_defined: z
				.array(UserDefinedInputSchema)
				.optional()
				.describe(
					"List of custom field entries {key, value}. " +
						"Useful for account numbers, IDs, or custom dates.",
				),
			relations: z
				.array(RelationInputSchema)
				.optional()
				.describe(
					"List of relation entries {person, type?}. " +
						"Types: spouse, child, parent, friend, manager, assistant, etc.",
				),
			notes: z
				.string()
				.optional()
				.describe("Notes/biography. Empty string clears existing notes."),
			address: z.string().optional().describe("Street address."),
			birthday: z
				.string()
				.optional()
				.describe(
					"Birthday as 'YYYY-MM-DD', 'MM-DD' (no year), or 'clear' to remove.",
				),
			phones_mode: MergeModeSchema.describe(
				'How to handle phones on update: "merge" (default), "replace", or "remove".',
			),
			emails_mode: MergeModeSchema.describe(
				'How to handle emails on update: "merge" (default), "replace", or "remove".',
			),
			organizations_mode: MergeModeSchema.describe(
				'How to handle organizations on update: "merge" (default), "replace", or "remove".',
			),
			nicknames_mode: MergeModeSchema.describe(
				'How to handle nicknames on update: "merge" (default), "replace", or "remove".',
			),
			urls_mode: MergeModeSchema.describe(
				'How to handle URLs on update: "merge" (default), "replace", or "remove".',
			),
			user_defined_mode: MergeModeSchema.describe(
				'How to handle custom fields on update: "merge" (default), "replace", or "remove".',
			),
			relations_mode: MergeModeSchema.describe(
				'How to handle relations on update: "merge" (default), "replace", or "remove".',
			),
			// Deprecated single-value aliases
			phone: z
				.string()
				.optional()
				.describe(
					"[Deprecated] Single phone number. Use phones=[{number:...,type:'mobile'}] instead.",
				),
			email: z
				.string()
				.optional()
				.describe(
					"[Deprecated] Email address. Use emails=[{address:...,type:'other'}] instead.",
				),
			organization: z
				.string()
				.optional()
				.describe(
					"[Deprecated] Company name. Use organizations=[{name:...}] instead.",
				),
			job_title: z
				.string()
				.optional()
				.describe(
					"[Deprecated] Job title. Use organizations=[{title:...}] instead.",
				),
		},
		async ({
			action,
			contact_id,
			given_name,
			family_name,
			phones,
			emails,
			organizations,
			nicknames,
			urls,
			user_defined,
			relations,
			notes,
			address,
			birthday,
			phones_mode,
			emails_mode,
			organizations_mode,
			nicknames_mode,
			urls_mode,
			user_defined_mode,
			relations_mode,
			phone,
			email,
			organization,
			job_title,
		}) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");

			// ── create ──────────────────────────────────────────────────────────
			if (action === "create") {
				const body = buildPersonBody({
					given_name,
					family_name,
					phones,
					emails,
					organizations,
					nicknames,
					urls,
					user_defined,
					relations,
					notes,
					address,
					birthday,
					phone,
					email,
					organization,
					job_title,
				});

				if (Object.keys(body).length === 0) {
					throw new Error(
						"At least one field (name, email, phone, etc.) must be provided.",
					);
				}

				const url = buildUrl(`${PEOPLE_BASE}/people:createContact`, {
					personFields: DETAILED_PERSON_FIELDS,
				});

				const result = (await peopleFetch(accessToken, url, {
					method: "POST",
					body: JSON.stringify(body),
				})) as PersonResponse;

				const text = `Contact Created for ${accountEmail}:\n\n${formatContact(result, true)}`;
				return { content: [{ type: "text" as const, text }] };
			}

			// update and delete both require contact_id
			if (!contact_id) {
				throw new Error(`contact_id is required for '${action}' action.`);
			}
			const resourceName = contact_id.startsWith("people/")
				? contact_id
				: `people/${contact_id}`;

			// ── update ──────────────────────────────────────────────────────────
			if (action === "update") {
				const maxRetries = 3;
				let lastError: Error | undefined;

				for (let attempt = 0; attempt < maxRetries; attempt++) {
					// Fetch current contact for etag and merge base
					const current = (await peopleFetch(
						accessToken,
						buildUrl(`${PEOPLE_BASE}/${resourceName}`, {
							personFields: DETAILED_PERSON_FIELDS,
						}),
					)) as PersonResponse;

					const etag = current.etag;
					if (!etag) {
						throw new Error("Unable to get contact etag for update.");
					}

					const newBody = buildPersonBody({
						given_name,
						family_name,
						phones,
						emails,
						organizations,
						nicknames,
						urls,
						user_defined,
						relations,
						notes,
						address,
						birthday,
						phone,
						email,
						organization,
						job_title,
					});

					if (Object.keys(newBody).length === 0) {
						throw new Error(
							"At least one field (name, email, phone, etc.) must be provided.",
						);
					}

					// Apply per-field merge modes for array fields
					const mergedBody: PersonBody = { ...newBody };

					if (newBody.phoneNumbers !== undefined) {
						mergedBody.phoneNumbers = mergePhones(
							current.phoneNumbers ?? [],
							newBody.phoneNumbers,
							phones_mode,
						);
					}
					if (newBody.emailAddresses !== undefined) {
						mergedBody.emailAddresses = mergeEmails(
							current.emailAddresses ?? [],
							newBody.emailAddresses,
							emails_mode,
						);
					}
					if (newBody.organizations !== undefined) {
						mergedBody.organizations = mergeOrganizations(
							current.organizations ?? [],
							newBody.organizations,
							organizations_mode,
						);
					}
					if (newBody.nicknames !== undefined) {
						mergedBody.nicknames = mergeNicknames(
							current.nicknames ?? [],
							newBody.nicknames,
							nicknames_mode,
						);
					}
					if (newBody.urls !== undefined) {
						mergedBody.urls = mergeUrls(
							current.urls ?? [],
							newBody.urls,
							urls_mode,
						);
					}
					if (newBody.userDefined !== undefined) {
						mergedBody.userDefined = mergeUserDefined(
							current.userDefined ?? [],
							newBody.userDefined,
							user_defined_mode,
						);
					}
					if (newBody.relations !== undefined) {
						mergedBody.relations = mergeRelations(
							current.relations ?? [],
							newBody.relations,
							relations_mode,
						);
					}

					mergedBody.etag = etag;

					// Build the updatePersonFields mask from present keys
					const updatePersonFields: string[] = [];
					if (mergedBody.names !== undefined) updatePersonFields.push("names");
					if (mergedBody.emailAddresses !== undefined)
						updatePersonFields.push("emailAddresses");
					if (mergedBody.phoneNumbers !== undefined)
						updatePersonFields.push("phoneNumbers");
					if (mergedBody.organizations !== undefined)
						updatePersonFields.push("organizations");
					if (mergedBody.nicknames !== undefined)
						updatePersonFields.push("nicknames");
					if (mergedBody.urls !== undefined) updatePersonFields.push("urls");
					if (mergedBody.userDefined !== undefined)
						updatePersonFields.push("userDefined");
					if (mergedBody.relations !== undefined)
						updatePersonFields.push("relations");
					if (mergedBody.biographies !== undefined)
						updatePersonFields.push("biographies");
					if (mergedBody.addresses !== undefined)
						updatePersonFields.push("addresses");
					if (mergedBody.birthdays !== undefined)
						updatePersonFields.push("birthdays");

					const updateUrl = buildUrl(
						`${PEOPLE_BASE}/${resourceName}:updateContact`,
						{
							updatePersonFields: updatePersonFields.join(","),
							personFields: DETAILED_PERSON_FIELDS,
						},
					);

					try {
						const result = (await peopleFetch(accessToken, updateUrl, {
							method: "PATCH",
							body: JSON.stringify(mergedBody),
						})) as PersonResponse;

						const text = `Contact Updated for ${accountEmail}:\n\n${formatContact(result, true)}`;
						return {
							content: [{ type: "text" as const, text }],
						};
					} catch (err) {
						// Retry on 412 Precondition Failed (etag conflict)
						if (
							err instanceof Error &&
							err.message.includes("Google API 412") &&
							attempt < maxRetries - 1
						) {
							lastError = err;
							continue;
						}
						throw err;
					}
				}

				throw lastError ?? new Error("Update failed after maximum retries.");
			}

			// ── delete ──────────────────────────────────────────────────────────
			await peopleFetch(
				accessToken,
				`${PEOPLE_BASE}/${resourceName}:deleteContact`,
				{ method: "DELETE" },
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Contact ${contact_id} has been deleted for ${accountEmail}.`,
					},
				],
			};
		},
	);

	// ── 5. list_contact_groups ────────────────────────────────────────────────
	server.tool(
		"list_contact_groups",
		"List contact groups (labels) for the connected Google account.",
		{
			page_size: z
				.number()
				.int()
				.default(100)
				.describe(
					"Maximum number of groups to return (default: 100, max: 1000).",
				),
			page_token: z.string().optional().describe("Token for pagination."),
		},
		async ({ page_size, page_token }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");
			const effectivePageSize = Math.min(Math.max(page_size, 1), 1000);

			const url = buildUrl(`${PEOPLE_BASE}/contactGroups`, {
				pageSize: effectivePageSize,
				pageToken: page_token,
				groupFields: CONTACT_GROUP_FIELDS,
			});

			const result = (await peopleFetch(
				accessToken,
				url,
			)) as ContactGroupsListResponse;
			const groups = result.contactGroups ?? [];
			const nextPageToken = result.nextPageToken;

			if (groups.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No contact groups found for ${accountEmail}.`,
						},
					],
				};
			}

			const lines = [`Contact Groups for ${accountEmail}:\n`];
			for (const group of groups) {
				const groupId = (group.resourceName ?? "").replace(
					"contactGroups/",
					"",
				);
				lines.push(`- ${group.name ?? "Unnamed"}`);
				lines.push(`  ID: ${groupId}`);
				lines.push(`  Type: ${group.groupType ?? "USER_CONTACT_GROUP"}`);
				lines.push(`  Members: ${group.memberCount ?? 0}\n`);
			}

			if (nextPageToken) {
				lines.push(`Next page token: ${nextPageToken}`);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 6. get_contact_group ──────────────────────────────────────────────────
	server.tool(
		"get_contact_group",
		"Get details of a specific contact group including its member IDs.",
		{
			group_id: z
				.string()
				.describe(
					'Contact group ID (e.g. "abc123") or full resource name (e.g. "contactGroups/abc123").',
				),
			max_members: z
				.number()
				.int()
				.default(100)
				.describe(
					"Maximum number of member resource names to return (default: 100, max: 1000).",
				),
		},
		async ({ group_id, max_members }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");
			const resourceName = group_id.startsWith("contactGroups/")
				? group_id
				: `contactGroups/${group_id}`;
			const effectiveMaxMembers = Math.min(Math.max(max_members, 1), 1000);

			const url = buildUrl(`${PEOPLE_BASE}/${resourceName}`, {
				maxMembers: effectiveMaxMembers,
				groupFields: CONTACT_GROUP_FIELDS,
			});

			const result = (await peopleFetch(
				accessToken,
				url,
			)) as ContactGroupResponse;
			const memberResourceNames = result.memberResourceNames ?? [];

			const lines = [
				`Contact Group Details for ${accountEmail}:\n`,
				`Name: ${result.name ?? "Unnamed"}`,
				`ID: ${group_id}`,
				`Type: ${result.groupType ?? "USER_CONTACT_GROUP"}`,
				`Total Members: ${result.memberCount ?? 0}`,
			];

			if (memberResourceNames.length > 0) {
				lines.push(`\nMembers (${memberResourceNames.length} shown):`);
				for (const member of memberResourceNames) {
					lines.push(`  - ${member.replace("people/", "")}`);
				}
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);

	// ── 7. manage_contacts_batch ──────────────────────────────────────────────
	server.tool(
		"manage_contacts_batch",
		"Batch create, update, or delete contacts " +
			"(up to 200 for create/update; up to 500 for delete).",
		{
			action: z
				.enum(["create", "update", "delete"])
				.describe('Action to perform: "create", "update", or "delete".'),
			contacts: z
				.array(ContactInputSchema)
				.optional()
				.describe('List of contact objects for "create" action.'),
			updates: z
				.array(ContactUpdateInputSchema)
				.optional()
				.describe(
					'List of update objects (each must include contact_id) for "update" action.',
				),
			contact_ids: StringListSchema.optional().describe(
				'Contact IDs (or resource names) for "delete" action.',
			),
			field: z
				.enum([
					"names",
					"phoneNumbers",
					"emailAddresses",
					"organizations",
					"nicknames",
					"urls",
					"userDefined",
					"relations",
					"biographies",
					"addresses",
					"birthdays",
				])
				.optional()
				.describe(
					'For "update": the single People API field to update across all contacts. ' +
						"Required. Use one field per batch call to avoid unintentional data loss.",
				),
		},
		async ({ action, contacts, updates, contact_ids, field }) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");

			// ── batch create ─────────────────────────────────────────────────
			if (action === "create") {
				if (!contacts || contacts.length === 0) {
					throw new Error(
						"contacts parameter is required for 'create' action.",
					);
				}
				if (contacts.length > 200) {
					throw new Error("Maximum 200 contacts can be created in a batch.");
				}

				const contactBodies: Array<{ contactPerson: PersonBody }> = [];
				for (const contact of contacts as ContactInput[]) {
					const body = buildPersonBody(contact);
					if (Object.keys(body).length > 0) {
						contactBodies.push({ contactPerson: body });
					}
				}

				if (contactBodies.length === 0) {
					throw new Error("No valid contact data provided.");
				}

				const result = (await peopleFetch(
					accessToken,
					`${PEOPLE_BASE}/people:batchCreateContacts`,
					{
						method: "POST",
						body: JSON.stringify({
							contacts: contactBodies,
							readMask: DEFAULT_PERSON_FIELDS,
						}),
					},
				)) as BatchCreateResponse;

				const createdPeople = result.createdPeople ?? [];
				const lines = [
					`Batch Create Results for ${accountEmail}:\n`,
					`Created ${createdPeople.length} contacts:\n`,
				];
				for (const item of createdPeople) {
					if (item.person) lines.push(`${formatContact(item.person)}\n`);
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			}

			// ── batch update ─────────────────────────────────────────────────
			if (action === "update") {
				if (!updates || updates.length === 0) {
					throw new Error("updates parameter is required for 'update' action.");
				}
				if (updates.length > 200) {
					throw new Error("Maximum 200 contacts can be updated in a batch.");
				}
				if (!field) {
					throw new Error(
						"field parameter is required for batch 'update' action. " +
							"Must be one of: names, phoneNumbers, emailAddresses, organizations, " +
							"nicknames, urls, userDefined, relations, biographies, addresses, birthdays. " +
							"Use a single field per batch call to avoid unintentional data loss.",
					);
				}

				// Normalise resource names
				const resourceNames: string[] = (updates as ContactUpdateInput[]).map(
					(u) =>
						u.contact_id.startsWith("people/")
							? u.contact_id
							: `people/${u.contact_id}`,
				);

				// Fetch etags via batchGet
				const batchGetUrl = buildBatchGetUrl(resourceNames, "metadata");
				const batchGetResult = (await peopleFetch(
					accessToken,
					batchGetUrl,
				)) as BatchGetResponse;

				const etags = new Map<string, string>();
				for (const resp of batchGetResult.responses ?? []) {
					const person = resp.person;
					if (person?.resourceName && person.etag) {
						etags.set(person.resourceName, person.etag);
					}
				}

				// Map People API field name → PersonBody key
				const fieldToBodyKey: Record<string, keyof PersonBody> = {
					names: "names",
					phoneNumbers: "phoneNumbers",
					emailAddresses: "emailAddresses",
					organizations: "organizations",
					nicknames: "nicknames",
					urls: "urls",
					userDefined: "userDefined",
					relations: "relations",
					biographies: "biographies",
					addresses: "addresses",
					birthdays: "birthdays",
				};
				const bodyKey = fieldToBodyKey[field];

				// Build contacts map: resourceName → {etag, [field]: value}
				const contactsMap: Record<string, Record<string, unknown>> = {};

				for (const update of updates as ContactUpdateInput[]) {
					const cid = update.contact_id.startsWith("people/")
						? update.contact_id
						: `people/${update.contact_id}`;

					const etag = etags.get(cid);
					if (!etag) continue; // skip contacts whose etag was not found

					const body = buildPersonBody(update);
					const fieldValue = body[bodyKey];
					if (fieldValue === undefined) continue;

					contactsMap[cid] = { etag, [bodyKey]: fieldValue };
				}

				if (Object.keys(contactsMap).length === 0) {
					throw new Error("No valid update data provided.");
				}

				const result = (await peopleFetch(
					accessToken,
					`${PEOPLE_BASE}/people:batchUpdateContacts`,
					{
						method: "POST",
						body: JSON.stringify({
							contacts: contactsMap,
							updateMask: field,
							readMask: DEFAULT_PERSON_FIELDS,
						}),
					},
				)) as BatchUpdateResponse;

				const updateResult = result.updateResult ?? {};
				const updatedCount = Object.keys(updateResult).length;
				const lines = [
					`Batch Update Results for ${accountEmail}:\n`,
					`Updated ${updatedCount} contacts:\n`,
				];
				for (const res of Object.values(updateResult)) {
					if (res.person) lines.push(`${formatContact(res.person)}\n`);
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			}

			// ── batch delete ─────────────────────────────────────────────────
			if (!contact_ids) {
				throw new Error(
					"contact_ids parameter is required for 'delete' action.",
				);
			}
			const ids = toStringArray(contact_ids);
			if (ids.length === 0) {
				throw new Error("contact_ids must not be empty.");
			}
			if (ids.length > 500) {
				throw new Error("Maximum 500 contacts can be deleted in a batch.");
			}

			const resourceNames = ids.map((cid) =>
				cid.startsWith("people/") ? cid : `people/${cid}`,
			);

			await peopleFetch(
				accessToken,
				`${PEOPLE_BASE}/people:batchDeleteContacts`,
				{
					method: "POST",
					body: JSON.stringify({ resourceNames }),
				},
			);

			return {
				content: [
					{
						type: "text" as const,
						text: `Batch deleted ${ids.length} contacts for ${accountEmail}.`,
					},
				],
			};
		},
	);

	// ── 8. manage_contact_group ───────────────────────────────────────────────
	server.tool(
		"manage_contact_group",
		"Create, update, or delete a contact group, or modify its members.",
		{
			action: z
				.enum(["create", "update", "delete", "modify_members"])
				.describe('Action: "create", "update", "delete", or "modify_members".'),
			group_id: z
				.string()
				.optional()
				.describe(
					'Contact group ID or resource name like "contactGroups/abc123". ' +
						'Required for "update", "delete", and "modify_members".',
				),
			name: z
				.string()
				.optional()
				.describe('Group name. Required for "create" and "update".'),
			delete_contacts: z
				.boolean()
				.default(false)
				.describe(
					'If true and action is "delete", also delete contacts in the group.',
				),
			add_contact_ids: StringListSchema.optional().describe(
				'Contact IDs to add to the group (for "modify_members").',
			),
			remove_contact_ids: StringListSchema.optional().describe(
				'Contact IDs to remove from the group (for "modify_members").',
			),
		},
		async ({
			action,
			group_id,
			name,
			delete_contacts,
			add_contact_ids,
			remove_contact_ids,
		}) => {
			const { accessToken, accountEmail } = await ctx.getService("gcontacts");

			// ── create ──────────────────────────────────────────────────────
			if (action === "create") {
				if (!name) {
					throw new Error("name is required for 'create' action.");
				}

				const result = (await peopleFetch(
					accessToken,
					`${PEOPLE_BASE}/contactGroups`,
					{
						method: "POST",
						body: JSON.stringify({ contactGroup: { name } }),
					},
				)) as ContactGroupResponse;

				const createdId = (result.resourceName ?? "").replace(
					"contactGroups/",
					"",
				);
				const lines = [
					`Contact Group Created for ${accountEmail}:\n`,
					`Name: ${result.name ?? name}`,
					`ID: ${createdId}`,
					`Type: ${result.groupType ?? "USER_CONTACT_GROUP"}`,
				];

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			}

			if (!group_id) {
				throw new Error(`group_id is required for '${action}' action.`);
			}
			const resourceName = group_id.startsWith("contactGroups/")
				? group_id
				: `contactGroups/${group_id}`;

			// ── update ──────────────────────────────────────────────────────
			if (action === "update") {
				if (!name) {
					throw new Error("name is required for 'update' action.");
				}

				const result = (await peopleFetch(
					accessToken,
					`${PEOPLE_BASE}/${resourceName}`,
					{
						method: "PUT",
						body: JSON.stringify({ contactGroup: { name } }),
					},
				)) as ContactGroupResponse;

				const lines = [
					`Contact Group Updated for ${accountEmail}:\n`,
					`Name: ${result.name ?? name}`,
					`ID: ${group_id}`,
				];

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			}

			// ── delete ──────────────────────────────────────────────────────
			if (action === "delete") {
				const deleteUrl = buildUrl(`${PEOPLE_BASE}/${resourceName}`, {
					deleteContacts: delete_contacts,
				});

				await peopleFetch(accessToken, deleteUrl, {
					method: "DELETE",
				});

				const preserveMsg = delete_contacts
					? " Contacts in the group were also deleted."
					: " Contacts in the group were preserved.";

				return {
					content: [
						{
							type: "text" as const,
							text: `Contact group ${group_id} has been deleted for ${accountEmail}.${preserveMsg}`,
						},
					],
				};
			}

			// ── modify_members ───────────────────────────────────────────────
			if (!add_contact_ids && !remove_contact_ids) {
				throw new Error(
					"At least one of add_contact_ids or remove_contact_ids must be provided.",
				);
			}

			const modifyBody: {
				resourceNamesToAdd?: string[];
				resourceNamesToRemove?: string[];
			} = {};

			if (add_contact_ids) {
				modifyBody.resourceNamesToAdd = toStringArray(add_contact_ids).map(
					(cid) => (cid.startsWith("people/") ? cid : `people/${cid}`),
				);
			}

			if (remove_contact_ids) {
				modifyBody.resourceNamesToRemove = toStringArray(
					remove_contact_ids,
				).map((cid) => (cid.startsWith("people/") ? cid : `people/${cid}`));
			}

			const result = (await peopleFetch(
				accessToken,
				`${PEOPLE_BASE}/${resourceName}/members:modify`,
				{
					method: "POST",
					body: JSON.stringify(modifyBody),
				},
			)) as ModifyMembersResponse;

			const notFound = result.notFoundResourceNames ?? [];
			const cannotRemove =
				result.canNotRemoveLastContactGroupResourceNames ?? [];

			const addCount = add_contact_ids
				? toStringArray(add_contact_ids).length
				: 0;
			const removeCount = remove_contact_ids
				? toStringArray(remove_contact_ids).length
				: 0;

			const lines = [
				`Contact Group Members Modified for ${accountEmail}:\n`,
				`Group: ${group_id}`,
			];
			if (addCount > 0) lines.push(`Added: ${addCount} contacts`);
			if (removeCount > 0) lines.push(`Removed: ${removeCount} contacts`);
			if (notFound.length > 0)
				lines.push(`\nNot found: ${notFound.join(", ")}`);
			if (cannotRemove.length > 0)
				lines.push(`Cannot remove (last group): ${cannotRemove.join(", ")}`);

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
			};
		},
	);
}
