import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const ALLOWED_PROTOCOLS = ["http:", "https:"];
const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (compatible; pi-web-search/0.1; +https://github.com/earendil-works/pi)";

const BLOCKED_HOST_PATTERNS = [/^localhost$/i];

function parseIPv4(value: string): number[] | undefined {
	const parts = value.split(".");
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
		return undefined;
	}
	const bytes = parts.map(Number);
	return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : undefined;
}

function parseIPv6(value: string): number[] | undefined {
	const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized.includes("%")) return undefined;
	const halves = normalized.split("::");
	if (halves.length > 2) return undefined;

	const parseHalf = (half: string): number[] | undefined => {
		if (!half) return [];
		const output: number[] = [];
		for (const part of half.split(":")) {
			if (part.includes(".")) {
				const ipv4 = parseIPv4(part);
				if (!ipv4) return undefined;
				output.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
			} else if (/^[0-9a-f]{1,4}$/.test(part)) {
				output.push(Number.parseInt(part, 16));
			} else {
				return undefined;
			}
		}
		return output;
	};

	const left = parseHalf(halves[0]);
	const right = parseHalf(halves.length === 2 ? halves[1] : "");
	if (!left || !right) return undefined;
	if (halves.length === 1) return left.length === 8 ? left : undefined;
	const gap = 8 - left.length - right.length;
	return gap > 0 ? [...left, ...Array(gap).fill(0), ...right] : undefined;
}

function isBlockedIPv4(bytes: number[]): boolean {
	const [a, b] = bytes;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && (b === 0 || b === 168)) ||
		(a === 198 && b >= 18 && b <= 19) ||
		a >= 224
	);
}

function isBlockedIp(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "");
	if (isIP(host) === 4) return isBlockedIPv4(parseIPv4(host) ?? []);
	if (isIP(host) !== 6) return false;

	const words = parseIPv6(host);
	if (!words) return false;
	const bytes = words.flatMap((word) => [word >> 8, word & 0xff]);
	const allZero = bytes.every((byte) => byte === 0);
	const loopback = allZero || (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1);
	const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
	return (
		loopback ||
		mapped && isBlockedIPv4(bytes.slice(12)) ||
		(bytes[0] & 0xfe) === 0xfc || // fc00::/7 (ULA)
		(bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || // fe80::/10
		bytes[0] === 0xff // multicast
	);
}

function isBlockedHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(normalized)) || isBlockedIp(normalized);
}

export interface SearchResult {
	title: string;
	url: string;
	abstract: string;
}

export interface WebReadResult {
	title: string;
	content: string;
	truncated: boolean;
}

export interface WebSearchClientOptions {
	searchTimeout?: number;
	fetchTimeout?: number;
	maxBuffer?: number;
	userAgent?: string;
}

export function validateUrl(rawUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid URL: "${rawUrl}"`);
	}
	if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
		throw new Error(
			`URL protocol "${parsed.protocol}" is not allowed. Only http: and https: are supported.`,
		);
	}
	const hostname = parsed.hostname.toLowerCase();
	if (isBlockedHostname(hostname)) {
		throw new Error(
			`URL hostname "${hostname}" points to a private/internal network and is blocked.`,
		);
	}
	return parsed;
}

async function validateFetchUrl(rawUrl: string): Promise<URL> {
	const parsed = validateUrl(rawUrl);
	const hostname = parsed.hostname.toLowerCase();
	if (isIP(hostname.replace(/^\[|\]$/g, ""))) return parsed;

	try {
		const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
		if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
			throw new Error(`URL hostname "${hostname}" resolves to a private/internal network and is blocked.`);
		}
	} catch (error) {
		if (error instanceof Error && /private\/internal network/.test(error.message)) throw error;
		throw new Error(`Could not safely resolve URL hostname "${hostname}".`);
	}
	return parsed;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelay = 500): Promise<T> {
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i === attempts - 1) throw error;
			const msg = error instanceof Error ? error.message : String(error);
			if (!/(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EPIPE|socket hang up|timeout)/i.test(msg)) {
				throw error;
			}
			await new Promise((r) => setTimeout(r, baseDelay * 2 ** i));
		}
	}
	throw new Error("unreachable");
}

function stripHtmlFallback(html: string): { title: string; content: string } {
	const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
	const title = titleMatch?.[1]?.trim() ?? "Untitled";
	const text = html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return { title, content: text };
}

function extractWithReadability(html: string, url: string): { title: string; content: string } | null {
	try {
		const { document } = parseHTML(html, { href: url });
		const reader = new Readability(document);
		const article = reader.parse();
		if (article?.textContent && article.textContent.length > 0) {
			return {
				title: article.title ?? "Untitled",
				content: article.textContent,
			};
		}
		return null;
	} catch {
		return null;
	}
}

async function fetchText(
	url: string,
	options: {
		timeout: number;
		maxBuffer: number;
		signal?: AbortSignal;
		userAgent: string;
	},
	redirectsRemaining = 5,
): Promise<string> {
	const validated = await validateFetchUrl(url);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(new Error("Request timed out")), options.timeout);
	const abortFromCaller = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener("abort", abortFromCaller, { once: true });

	try {
		const response = await fetch(validated.href, {
			redirect: "manual",
			signal: controller.signal,
			headers: {
				"user-agent": options.userAgent,
				accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
		});

		if (response.status >= 300 && response.status < 400) {
			if (redirectsRemaining <= 0) {
				throw new Error(`Too many redirects while fetching ${validated.href}`);
			}
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect response from ${validated.href} did not include a Location header`);
			}
			const redirectedUrl = new URL(location, validated.href).href;
			return fetchText(redirectedUrl, options, redirectsRemaining - 1);
		}

		if (!response.ok) {
			throw new Error(`Request failed for ${validated.href}: HTTP ${response.status}`);
		}

		const contentLength = response.headers.get("content-length");
		if (contentLength) {
			const length = Number(contentLength);
			if (Number.isFinite(length) && length > options.maxBuffer) {
				throw new Error(`Response from ${validated.href} is too large`);
			}
		}

		// Content-Length is advisory. Enforce the limit while streaming so a
		// chunked or misleading response cannot consume unbounded memory.
		const reader = response.body?.getReader();
		if (!reader) return new TextDecoder().decode(await response.arrayBuffer());

		const chunks: Uint8Array[] = [];
		let total = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = value as Uint8Array;
				total += chunk.byteLength;
				if (total > options.maxBuffer) {
					throw new Error(`Response from ${validated.href} is too large`);
				}
				chunks.push(chunk);
			}
		} catch (error) {
			await reader.cancel().catch(() => {});
			throw error;
		}

		const buffer = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			buffer.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return new TextDecoder().decode(buffer);
	} finally {
		clearTimeout(timeoutId);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl, SEARCH_ENDPOINT);
		const target = parsed.searchParams.get("uddg");
		if (target) return target;
		return parsed.href;
	} catch {
		return rawUrl;
	}
}

export function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
	const { document } = parseHTML(html);
	const results: SearchResult[] = [];

	for (const node of Array.from(document.querySelectorAll(".result"))) {
		const link = node.querySelector<HTMLAnchorElement>("a.result__a");
		if (!link) continue;

		const title = normalizeWhitespace(link.textContent ?? "");
		let url: string;
		try {
			url = validateUrl(unwrapDuckDuckGoUrl(link.getAttribute("href") ?? "")).href;
		} catch {
			continue;
		}
		const abstract = normalizeWhitespace(
			node.querySelector(".result__snippet")?.textContent ?? "",
		);

		if (title && url) {
			results.push({ title, url, abstract });
		}
		if (results.length >= maxResults) break;
	}

	return results;
}

export class WebSearchClient {
	private readonly searchTimeout: number;
	private readonly fetchTimeout: number;
	private readonly maxBuffer: number;
	private readonly userAgent: string;

	constructor(options: WebSearchClientOptions = {}) {
		this.searchTimeout = options.searchTimeout ?? 15_000;
		this.fetchTimeout = options.fetchTimeout ?? 15_000;
		this.maxBuffer = options.maxBuffer ?? 5 * 1024 * 1024;
		this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
	}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
		return withRetry(async () => {
			const searchUrl = new URL(SEARCH_ENDPOINT);
			searchUrl.searchParams.set("q", query);
			const html = await fetchText(searchUrl.href, {
				timeout: this.searchTimeout,
				maxBuffer: 1024 * 1024,
				signal,
				userAgent: this.userAgent,
			});
			return parseDuckDuckGoResults(html, maxResults);
		});
	}

	async readPage(url: string, maxChars: number, signal?: AbortSignal): Promise<WebReadResult> {
		const validatedUrl = validateUrl(url).href;
		const html = await withRetry(() =>
			fetchText(validatedUrl, {
				timeout: this.fetchTimeout,
				maxBuffer: this.maxBuffer,
				signal,
				userAgent: this.userAgent,
			}),
		);

		if (!html || html.trim().length === 0) {
			throw new Error(`Failed to fetch content from ${validatedUrl}`);
		}

		// Tier 1: Mozilla Readability
		const readable = extractWithReadability(html, validatedUrl);
		if (readable) {
			const truncated = readable.content.length > maxChars;
			return {
				title: readable.title,
				content: truncated ? readable.content.slice(0, maxChars) + "\n\n[Content truncated]" : readable.content,
				truncated,
			};
		}

		// Tier 2: Basic regex HTML stripping
		const fallback = stripHtmlFallback(html);
		const truncated = fallback.content.length > maxChars;
		return {
			title: fallback.title,
			content: truncated ? fallback.content.slice(0, maxChars) + "\n\n[Content truncated]" : fallback.content,
			truncated,
		};
	}

	async checkAvailability(): Promise<{ fetch: boolean }> {
		return { fetch: typeof fetch === "function" };
	}
}
