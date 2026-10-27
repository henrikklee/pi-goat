/**
 * Conversation rewind / redo for pi-goat (our own tool).
 *
 * Pure session-tree navigation — NO file system access of any kind (no reads,
 * no writes, no git). Rewinds the conversation cursor to the crossing before a
 * previous user message via `ctx.navigateTree`, exactly like pi's tree, so the
 * abandoned continuation becomes a branch you can return to.
 *
 * - `/rewind`      — move back one user message (or `/rewind N` for N)
 * - `/redo`        — move forward again to the branch you rewound from
 *
 * A new prompt invalidates the redo stack (rewinding again starts fresh).
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface SessionEntry {
	id: string;
	parentId: string | null;
	type: string;
	message?: { role?: string };
}

const MAX_REWIND_STEPS = 50;

function asEntries(value: unknown): SessionEntry[] {
	return Array.isArray(value) ? (value as SessionEntry[]).filter((entry) => typeof entry === "object" && entry !== null) : [];
}

function isUserMessage(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message?.role === "user";
}

function indexById(entries: SessionEntry[]): Map<string, SessionEntry> {
	return new Map(entries.map((entry) => [entry.id, entry]));
}

/**
 * Walk the parent chain from `leafId` and return the entry ids of the last
 * `max` user messages, most recent first.
 */
function lastUserEntryIds(
	byId: Map<string, SessionEntry>,
	leafId: string | null,
	max: number,
): string[] {
	const found: string[] = [];
	const visited = new Set<string>();
	let current = leafId === null ? undefined : byId.get(leafId);
	while (current !== undefined && found.length < max) {
		if (visited.has(current.id)) break;
		visited.add(current.id);
		if (isUserMessage(current)) found.push(current.id);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return found;
}

function parseSteps(raw: string): number {
	const trimmed = raw.trim();
	if (trimmed === "") return 1;
	const steps = Number(trimmed);
	if (!Number.isInteger(steps) || steps < 1) return 1;
	return Math.min(steps, MAX_REWIND_STEPS);
}

async function ensureIdle(ctx: ExtensionCommandContext): Promise<boolean> {
	if (ctx.isIdle()) return true;
	try {
		ctx.abort();
		const deadline = Date.now() + 30_000;
		const remaining = Math.max(0, deadline - Date.now());
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				ctx.waitForIdle().then(() => true, () => false),
				new Promise<boolean>((resolveTimeout) => {
					timeout = setTimeout(() => resolveTimeout(false), remaining);
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	} catch {
		return false;
	}
}

export default function rewindExtension(pi: ExtensionAPI): void {
	const redoStack: string[] = [];

	pi.registerCommand("rewind", {
		description: "Rewind the conversation to a previous user message (no file changes)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const steps = parseSteps(args);
			if (!(await ensureIdle(ctx))) {
				ctx.ui.notify("Agent is still active; retry when idle", "warning");
				return;
			}

			const entries = asEntries(ctx.sessionManager.getEntries());
			const byId = indexById(entries);
			const leafId = ctx.sessionManager.getLeafId();
			const userEntryIds = lastUserEntryIds(byId, leafId, steps);

			const targetUserEntryId = userEntryIds[steps - 1];
			if (targetUserEntryId === undefined) {
				ctx.ui.notify(`Cannot rewind ${steps} step(s): fewer previous messages exist`, "warning");
				return;
			}

			const targetUserEntry = byId.get(targetUserEntryId);
			const targetParentId = targetUserEntry?.parentId ?? null;
			if (targetParentId === null) {
				ctx.ui.notify("Already at the start of the conversation", "info");
				return;
			}

			// Navigate to the user message entry itself, NOT its parent: pi's
			// SessionManager.navigateTree treats user-message targets specially -
			// the leaf lands on the crossing (the message's parent, where the run
			// started) AND it returns editorText with that message, which the TUI
			// restores into the editor. Targeting the parent directly would leave
			// editorText undefined, so the editor stays empty and the rewind
			// becomes destructive (previous prompt unrecoverable from the editor).
			const previousLeaf = leafId;
			const result = await ctx.navigateTree(targetUserEntryId, { summarize: false });
			if (result.cancelled) {
				ctx.ui.notify("Rewind cancelled", "warning");
				return;
			}
			redoStack.length = 0;
			if (previousLeaf !== null) redoStack.push(previousLeaf);
			ctx.ui.notify(`Rewound ${steps} message(s); type or /redo to continue forward`, "info");
		},
	});

	pi.registerCommand("redo", {
		description: "Move the conversation forward to the branch you rewound from",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const target = redoStack.pop();
			if (target === undefined) {
				ctx.ui.notify("Nothing to redo", "info");
				return;
			}
			if (!(await ensureIdle(ctx))) {
				redoStack.push(target);
				ctx.ui.notify("Agent is still active; retry when idle", "warning");
				return;
			}
			const result = await ctx.navigateTree(target, { summarize: false });
			if (result.cancelled) ctx.ui.notify("Redo cancelled", "warning");
		},
	});

	// A fresh prompt invalidates the forward stack: history moved on.
	pi.on("before_agent_start", () => {
		redoStack.length = 0;
	});
}