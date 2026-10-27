import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { constants } from "fs";
import { dirname } from "path";
import {
	access as fsAccess,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	rename as fsRename,
	rm as fsRm,
	rmdir as fsRmdir,
	stat as fsStat,
	unlink as fsUnlink,
	writeFile as fsWriteFile,
} from "fs/promises";
import { randomUUID } from "crypto";

import type { Workspace } from "./types.ts";

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

async function checkTargetWriteAccess(
	absolutePath: string,
	existingTargetMode: number,
): Promise<void> {
	try {
		await fsAccess(absolutePath, constants.F_OK);
	} catch (error) {
		if (!hasErrorCode(error, "ENOENT")) throw error;

		// The immediate parent may not exist for an add-file operation. Walk to
		// the nearest existing ancestor and verify mkdir can create the missing
		// path beneath it without mutating the filesystem during preflight.
		let ancestor = dirname(absolutePath);
		while (true) {
			try {
				const info = await fsStat(ancestor);
				if (!info.isDirectory()) {
					throw new Error(`Parent path is not a directory: ${ancestor}`);
				}
				await fsAccess(ancestor, constants.W_OK | constants.X_OK);
				return;
			} catch (ancestorError) {
				if (!hasErrorCode(ancestorError, "ENOENT")) throw ancestorError;
				const parent = dirname(ancestor);
				if (parent === ancestor) throw ancestorError;
				ancestor = parent;
			}
		}
	}

	await fsAccess(absolutePath, existingTargetMode);
}

export function createRealWorkspace(pi: ExtensionAPI): Workspace {
	const readCache = new Map<string, string>();
	const createdDirectories = new Set<string>();

	async function ensureParentDirectories(absolutePath: string): Promise<void> {
		const targetParent = dirname(absolutePath);
		const firstCreated = await fsMkdir(targetParent, { recursive: true });
		if (!firstCreated) return;

		// mkdir({ recursive: true }) returns the first directory it created.
		// Track that directory and every descendant created for this target so a
		// rollback can remove them again if they are still empty.
		let current = targetParent;
		while (true) {
			createdDirectories.add(current);
			if (current === firstCreated) break;
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}

	async function cleanupCreatedDirectories(): Promise<void> {
		const deepestFirst = [...createdDirectories].sort(
			(a, b) => b.split("/").length - a.split("/").length,
		);
		for (const directory of deepestFirst) {
			try {
				await fsRmdir(directory);
				createdDirectories.delete(directory);
			} catch (error) {
				if (hasErrorCode(error, "ENOENT")) {
					createdDirectories.delete(directory);
				}
				// Non-empty or externally modified directories are intentionally kept.
			}
		}
	}

	return {
		readText: async (absolutePath: string) => {
			if (readCache.has(absolutePath)) return readCache.get(absolutePath)!;
			const content = await fsReadFile(absolutePath, "utf-8");
			readCache.set(absolutePath, content);
			return content;
		},
		writeText: async (absolutePath: string, content: string) => {
			// Skip the write (and the file-modified event) when content is
			// identical to what we last read. Prevents thrashing downstream
			// consumers (watchers, context-guard) after no-op dedups.
			const existing = readCache.get(absolutePath);
			if (existing === content) return;

			// Write beside the target and rename into place so readers never see
			// a partially-written file. Preserve the existing mode where possible.
			const temporaryPath = `${absolutePath}.pi-goat-${randomUUID()}.tmp`;
			let mode: number | undefined;
			try {
				mode = (await fsStat(absolutePath)).mode & 0o777;
			} catch {
				// New files use the process umask via the default 0666 mode.
			}

			readCache.delete(absolutePath);
			let completed = false;
			try {
				await ensureParentDirectories(absolutePath);
				await fsWriteFile(temporaryPath, content, {
					encoding: "utf8",
					mode: mode ?? 0o666,
				});
				await fsRename(temporaryPath, absolutePath);
				completed = true;
			} finally {
				await fsRm(temporaryPath, { force: true }).catch(() => {});
				if (!completed) await cleanupCreatedDirectories();
			}
			pi.events.emit("context-guard:file-modified", { path: absolutePath });
		},
		deleteFile: async (absolutePath: string) => {
			readCache.delete(absolutePath);
			await fsUnlink(absolutePath);
			await cleanupCreatedDirectories();
			pi.events.emit("context-guard:file-modified", { path: absolutePath });
		},
		exists: async (absolutePath: string) => {
			try {
				await fsAccess(absolutePath, constants.F_OK);
				return true;
			} catch {
				return false;
			}
		},
		checkWriteAccess: async (absolutePath: string) => {
			await checkTargetWriteAccess(
				absolutePath,
				constants.R_OK | constants.W_OK,
			);
		},
	};
}

export function createVirtualWorkspace(cwd: string): Workspace {
	const state = new Map<string, string | null>();

	async function ensureLoaded(absolutePath: string): Promise<void> {
		if (state.has(absolutePath)) return;
		try {
			const content = await fsReadFile(absolutePath, "utf-8");
			state.set(absolutePath, content);
		} catch {
			state.set(absolutePath, null);
		}
	}

	return {
		readText: async (absolutePath) => {
			await ensureLoaded(absolutePath);
			const content = state.get(absolutePath);
			if (content === null || content === undefined) {
				throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
			}
			return content;
		},
		writeText: async (absolutePath, content) => {
			state.set(absolutePath, content);
		},
		deleteFile: async (absolutePath) => {
			await ensureLoaded(absolutePath);
			if (state.get(absolutePath) === null) {
				throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
			}
			state.set(absolutePath, null);
		},
		exists: async (absolutePath) => {
			await ensureLoaded(absolutePath);
			return state.get(absolutePath) !== null;
		},
		checkWriteAccess: async (absolutePath: string) => {
			// Check real-fs write permission during the virtual preflight so
			// that read-only files fail fast *before* any real file is touched.
			await checkTargetWriteAccess(absolutePath, constants.W_OK);
		},
	};
}
