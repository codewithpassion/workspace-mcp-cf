import {
	adjectives,
	animals,
	colors,
	uniqueNamesGenerator,
} from "unique-names-generator";

/** Random 3-word slug, e.g. "calm-violet-otter". Matches the server SLUG_RE. */
export function generateSlug(): string {
	return uniqueNamesGenerator({
		dictionaries: [adjectives, colors, animals],
		separator: "-",
		length: 3,
	});
}
