// Google Contacts helpers — pure utility functions for parsing, normalising,
// formatting, and merging Google Contacts (People API) data.
// All functions operate on plain objects and have no side effects.

// ─── People API response types ────────────────────────────────────────────────

export interface PhoneEntry {
	value?: string;
	type?: string;
	formattedType?: string;
	canonicalForm?: string;
}

export interface EmailEntry {
	value?: string;
	type?: string;
	formattedType?: string;
}

export interface OrgEntry {
	name?: string;
	title?: string;
	department?: string;
	jobDescription?: string;
	description?: string;
	type?: string;
}

export interface NicknameEntry {
	value?: string;
	type?: string;
}

export interface UrlEntry {
	value?: string;
	type?: string;
}

export interface UserDefinedEntry {
	key?: string;
	value?: string;
}

export interface RelationEntry {
	person?: string;
	type?: string;
	formattedType?: string;
}

export interface NameEntry {
	displayName?: string;
	givenName?: string;
	familyName?: string;
}

export interface BioEntry {
	value?: string;
	contentType?: string;
}

export interface AddressEntry {
	formattedValue?: string;
}

export interface BirthdayDate {
	month?: number;
	day?: number;
	year?: number;
}

export interface BirthdayEntry {
	date?: BirthdayDate;
}

export interface MetadataSource {
	type?: string;
}

export interface MetadataEntry {
	sources?: MetadataSource[];
}

export interface PersonResponse {
	resourceName?: string;
	etag?: string;
	names?: NameEntry[];
	nicknames?: NicknameEntry[];
	emailAddresses?: EmailEntry[];
	phoneNumbers?: PhoneEntry[];
	organizations?: OrgEntry[];
	biographies?: BioEntry[];
	addresses?: AddressEntry[];
	birthdays?: BirthdayEntry[];
	urls?: UrlEntry[];
	userDefined?: UserDefinedEntry[];
	relations?: RelationEntry[];
	metadata?: MetadataEntry;
}

// ─── Birthday parsing ─────────────────────────────────────────────────────────

/**
 * Parse "YYYY-MM-DD" or "MM-DD" into a People API birthday object.
 * Validates the date exists (e.g. rejects Feb 30).
 */
export function parseBirthday(s: string): BirthdayEntry {
	const parts = s.trim().split("-");
	let year: number | undefined;
	let month: number;
	let day: number;

	if (parts.length === 3) {
		year = Number.parseInt(parts[0], 10);
		month = Number.parseInt(parts[1], 10);
		day = Number.parseInt(parts[2], 10);
	} else if (parts.length === 2) {
		month = Number.parseInt(parts[0], 10);
		day = Number.parseInt(parts[1], 10);
	} else {
		throw new Error(
			`Invalid birthday format '${s}'. Use 'YYYY-MM-DD' or 'MM-DD'.`,
		);
	}

	if (
		Number.isNaN(month) ||
		Number.isNaN(day) ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31
	) {
		throw new Error(
			`Invalid birthday '${s}': month must be 1-12 and day must be 1-31.`,
		);
	}

	// Validate the date exists — use a leap year for year-less dates so Feb 29 is valid.
	const checkYear = year ?? 2000;
	const checkDate = new Date(checkYear, month - 1, day);
	if (
		checkDate.getFullYear() !== checkYear ||
		checkDate.getMonth() !== month - 1 ||
		checkDate.getDate() !== day
	) {
		throw new Error(`Invalid birthday '${s}': not a real calendar date.`);
	}

	const date: BirthdayDate = { month, day };
	if (year !== undefined) date.year = year;
	return { date };
}

// ─── Normalisation helpers (private — used only for deduplication) ────────────

function normalizePhone(value: string): string {
	return value.replace(/[^\d+]/g, "").toLowerCase();
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeNickname(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeUrl(value: string): string {
	let s = value.trim().toLowerCase();
	if (s.endsWith("/")) s = s.slice(0, -1);
	return s;
}

function normalizeUserDefinedKey(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeRelationPerson(value: string): string {
	return value.trim().toLowerCase();
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatPhoneLine(phone: PhoneEntry): string {
	const value = phone.value ?? "";
	const phoneType = phone.type ?? "";
	const formattedType = phone.formattedType ?? "";

	let label: string;
	if (phoneType === "internal") {
		label = "Internal";
	} else if (formattedType) {
		label = formattedType;
	} else if (phoneType) {
		label = phoneType;
	} else {
		label = "";
	}

	return label ? `${value} (${label})` : value;
}

export function formatEmailLine(email: EmailEntry): string {
	const value = email.value ?? "";
	const label = email.formattedType || email.type || "";
	return label ? `${value} (${label})` : value;
}

/** Format a People API Person resource into a human-readable string. */
export function formatContact(
	person: PersonResponse,
	detailed = false,
): string {
	const resourceName = person.resourceName ?? "Unknown";
	const contactId = resourceName.replace("people/", "");

	const lines: string[] = [`Contact ID: ${contactId}`];

	// Names
	const names = person.names ?? [];
	if (names.length > 0) {
		const displayName = names[0].displayName;
		if (displayName) lines.push(`Name: ${displayName}`);
	}

	// Nicknames
	const nicknames = person.nicknames ?? [];
	if (nicknames.length > 0) {
		const vals = nicknames
			.map((n) => n.value)
			.filter((v): v is string => Boolean(v));
		if (vals.length > 0) lines.push(`Nicknames: ${vals.join(", ")}`);
	}

	// Email addresses
	const validEmails = (person.emailAddresses ?? []).filter((e) => e.value);
	if (validEmails.length > 0) {
		if (validEmails.length === 1) {
			lines.push(`Email: ${formatEmailLine(validEmails[0])}`);
		} else {
			lines.push("Emails:");
			for (const e of validEmails) lines.push(`  - ${formatEmailLine(e)}`);
		}
	}

	// Phone numbers
	const validPhones = (person.phoneNumbers ?? []).filter((p) => p.value);
	if (validPhones.length > 0) {
		if (validPhones.length === 1) {
			lines.push(`Phone: ${formatPhoneLine(validPhones[0])}`);
		} else {
			lines.push("Phones:");
			for (const p of validPhones) lines.push(`  - ${formatPhoneLine(p)}`);
		}
	}

	// Organizations (first one summarised)
	const orgs = person.organizations ?? [];
	if (orgs.length > 0) {
		const org = orgs[0];
		const parts: string[] = [];
		if (org.title) parts.push(org.title);
		if (org.name) parts.push(`at ${org.name}`);
		if (parts.length > 0) lines.push(`Organization: ${parts.join(" ")}`);
	}

	if (detailed) {
		// Addresses
		const addresses = person.addresses ?? [];
		if (addresses.length > 0) {
			const addr = addresses[0].formattedValue;
			if (addr) lines.push(`Address: ${addr}`);
		}

		// Birthday
		const birthdays = person.birthdays ?? [];
		if (birthdays.length > 0) {
			const bday = birthdays[0].date;
			if (bday) {
				let s = `${bday.month ?? "?"}/${bday.day ?? "?"}`;
				if (bday.year) s = `${bday.year}/${s}`;
				lines.push(`Birthday: ${s}`);
			}
		}

		// URLs
		const urlVals = (person.urls ?? [])
			.map((u) => u.value)
			.filter((v): v is string => Boolean(v));
		if (urlVals.length > 0) lines.push(`URLs: ${urlVals.join(", ")}`);

		// Custom fields
		const validUd = (person.userDefined ?? []).filter(
			(ud) => ud.key && ud.value,
		);
		if (validUd.length > 0) {
			lines.push("Custom Fields:");
			for (const ud of validUd) lines.push(`  - ${ud.key}: ${ud.value}`);
		}

		// Relations
		const validRels = (person.relations ?? []).filter((r) => r.person);
		if (validRels.length > 0) {
			lines.push("Relations:");
			for (const r of validRels) {
				const relType = r.formattedType || r.type || "";
				lines.push(
					relType ? `  - ${r.person} (${relType})` : `  - ${r.person}`,
				);
			}
		}

		// Biography/Notes (truncated at 200 chars)
		const bios = person.biographies ?? [];
		if (bios.length > 0) {
			let bio = bios[0].value ?? "";
			if (bio) {
				if (bio.length > 200) bio = `${bio.slice(0, 200)}...`;
				lines.push(`Notes: ${bio}`);
			}
		}

		// Metadata sources
		const sources = person.metadata?.sources ?? [];
		if (sources.length > 0) {
			const types = sources.map((s) => s.type).filter(Boolean);
			if (types.length > 0) lines.push(`Sources: ${types.join(", ")}`);
		}
	}

	return lines.join("\n");
}

// ─── Merge helpers ────────────────────────────────────────────────────────────
// Each helper supports three modes:
//   "replace" — overwrite existing list with new list
//   "remove"  — remove entries from existing list that match new list
//   "merge"   — add new entries not already present (dedup by normalized key)

export function mergePhones(
	existing: PhoneEntry[],
	newPhones: PhoneEntry[],
	mode: string,
): PhoneEntry[] {
	const phoneKey = (p: PhoneEntry): string =>
		normalizePhone(p.canonicalForm ?? p.value ?? "");

	if (mode === "replace") return newPhones;
	if (mode === "remove") {
		const remove = new Set(newPhones.map((p) => normalizePhone(p.value ?? "")));
		return existing.filter((p) => !remove.has(normalizePhone(p.value ?? "")));
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map(phoneKey));
	for (const p of newPhones) {
		const k = phoneKey(p);
		if (!seen.has(k)) {
			result.push(p);
			seen.add(k);
		}
	}
	return result;
}

export function mergeEmails(
	existing: EmailEntry[],
	newEmails: EmailEntry[],
	mode: string,
): EmailEntry[] {
	if (mode === "replace") return newEmails;
	if (mode === "remove") {
		const remove = new Set(newEmails.map((e) => normalizeEmail(e.value ?? "")));
		return existing.filter((e) => !remove.has(normalizeEmail(e.value ?? "")));
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map((e) => normalizeEmail(e.value ?? "")));
	for (const e of newEmails) {
		const k = normalizeEmail(e.value ?? "");
		if (!seen.has(k)) {
			result.push(e);
			seen.add(k);
		}
	}
	return result;
}

type OrgKey = [string, string, string, string, string];

function orgKey(org: OrgEntry): OrgKey {
	return [
		(org.name ?? "").trim().toLowerCase(),
		(org.title ?? "").trim().toLowerCase(),
		(org.department ?? "").trim().toLowerCase(),
		(org.jobDescription ?? org.description ?? "").trim().toLowerCase(),
		(org.type ?? "").trim().toLowerCase(),
	];
}

export function mergeOrganizations(
	existing: OrgEntry[],
	newOrgs: OrgEntry[],
	mode: string,
): OrgEntry[] {
	const keyStr = (k: OrgKey): string => k.join("\x00");

	if (mode === "replace") return newOrgs;
	if (mode === "remove") {
		const remove = new Set(newOrgs.map((o) => keyStr(orgKey(o))));
		return existing.filter((o) => !remove.has(keyStr(orgKey(o))));
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map((o) => keyStr(orgKey(o))));
	for (const o of newOrgs) {
		const k = keyStr(orgKey(o));
		if (!seen.has(k)) {
			result.push(o);
			seen.add(k);
		}
	}
	return result;
}

export function mergeNicknames(
	existing: NicknameEntry[],
	newNicknames: NicknameEntry[],
	mode: string,
): NicknameEntry[] {
	if (mode === "replace") return newNicknames;
	if (mode === "remove") {
		const remove = new Set(
			newNicknames.map((n) => normalizeNickname(n.value ?? "")),
		);
		return existing.filter(
			(n) => !remove.has(normalizeNickname(n.value ?? "")),
		);
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map((n) => normalizeNickname(n.value ?? "")));
	for (const n of newNicknames) {
		const k = normalizeNickname(n.value ?? "");
		if (!seen.has(k)) {
			result.push(n);
			seen.add(k);
		}
	}
	return result;
}

export function mergeUrls(
	existing: UrlEntry[],
	newUrls: UrlEntry[],
	mode: string,
): UrlEntry[] {
	if (mode === "replace") return newUrls;
	if (mode === "remove") {
		const remove = new Set(newUrls.map((u) => normalizeUrl(u.value ?? "")));
		return existing.filter((u) => !remove.has(normalizeUrl(u.value ?? "")));
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map((u) => normalizeUrl(u.value ?? "")));
	for (const u of newUrls) {
		const k = normalizeUrl(u.value ?? "");
		if (!seen.has(k)) {
			result.push(u);
			seen.add(k);
		}
	}
	return result;
}

export function mergeUserDefined(
	existing: UserDefinedEntry[],
	newUd: UserDefinedEntry[],
	mode: string,
): UserDefinedEntry[] {
	if (mode === "replace") return newUd;
	if (mode === "remove") {
		const remove = new Set(
			newUd.map((ud) => normalizeUserDefinedKey(ud.key ?? "")),
		);
		return existing.filter(
			(ud) => !remove.has(normalizeUserDefinedKey(ud.key ?? "")),
		);
	}
	// merge: new value overrides existing for matching key; new keys appended
	const newByKey = new Map(
		newUd.map((ud) => [normalizeUserDefinedKey(ud.key ?? ""), ud]),
	);
	const result: UserDefinedEntry[] = [];
	const seen = new Set<string>();
	for (const ud of existing) {
		const k = normalizeUserDefinedKey(ud.key ?? "");
		const replacement = newByKey.get(k);
		if (replacement !== undefined) {
			result.push(replacement);
			seen.add(k);
		} else {
			result.push(ud);
		}
	}
	for (const [k, ud] of newByKey) {
		if (!seen.has(k)) result.push(ud);
	}
	return result;
}

export function mergeRelations(
	existing: RelationEntry[],
	newRelations: RelationEntry[],
	mode: string,
): RelationEntry[] {
	const relationKey = (r: RelationEntry): string => {
		const label = r.formattedType ?? r.type ?? "";
		return `${normalizeRelationPerson(r.person ?? "")}\x00${label.trim().toLowerCase()}`;
	};

	if (mode === "replace") return newRelations;
	if (mode === "remove") {
		const remove = new Set(newRelations.map(relationKey));
		return existing.filter((r) => !remove.has(relationKey(r)));
	}
	// merge
	const result = [...existing];
	const seen = new Set(existing.map(relationKey));
	for (const r of newRelations) {
		const k = relationKey(r);
		if (!seen.has(k)) {
			result.push(r);
			seen.add(k);
		}
	}
	return result;
}
