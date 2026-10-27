import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { mock } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createRealWorkspace, createVirtualWorkspace } from "../workspace.ts";

// Pi supplies this module virtually at runtime. The patch test does not collect
// diffs, so a minimal stub keeps the focused filesystem regression standalone.
mock.module("@earendil-works/pi-coding-agent", () => ({
	generateDiffString: () => ({ diff: "", firstChangedLine: undefined }),
}));
const { applyPatchOperations, parsePatch } = await import("../patch.ts");

const stubPi = {
	events: { emit: () => {} },
} as unknown as ExtensionAPI;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "pi-goat-workspace-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("nested add-file workspace support", () => {
	test("virtual preflight accepts a target beneath missing directories", async () => {
		await withTmp(async (dir) => {
			const target = join(dir, "src", "components", "Button.ts");
			await createVirtualWorkspace(dir).checkWriteAccess(target);
		});
	});

	test("real writes create parents and rollback cleanup preserves existing ancestors", async () => {
		await withTmp(async (dir) => {
			const existing = join(dir, "existing");
			const createdRoot = join(existing, "generated");
			const target = join(createdRoot, "deep", "Button.ts");
			await mkdir(existing);

			const workspace = createRealWorkspace(stubPi);
			await workspace.writeText(target, "export const Button = {};\n");

			assert.equal(
				await readFile(target, "utf8"),
				"export const Button = {};\n",
			);

			// Simulate applyPatchOperations rolling back a newly added file.
			await workspace.deleteFile(target);
			assert.equal(await exists(createdRoot), false);
			assert.equal(await exists(existing), true);
		});
	});

	test("apply_patch creates nested files and removes their directories on rollback", async () => {
		await withTmp(async (dir) => {
			const patch = [
				"*** Begin Patch",
				"*** Add File: src/components/Button.ts",
				"+export const Button = {};",
				"*** End Patch",
			].join("\n");
			const operations = parsePatch(patch);

			await applyPatchOperations(
				operations,
				createVirtualWorkspace(dir),
				dir,
			);
			await applyPatchOperations(
				operations,
				createRealWorkspace(stubPi),
				dir,
			);

			assert.equal(
				await readFile(join(dir, "src", "components", "Button.ts"), "utf8"),
				"export const Button = {};\n",
			);

			const rollbackOperations = parsePatch([
				"*** Begin Patch",
				"*** Add File: generated/deep/file.ts",
				"+created",
				"*** Delete File: missing.txt",
				"*** End Patch",
			].join("\n"));
			await assert.rejects(
				() => applyPatchOperations(
					rollbackOperations,
					createRealWorkspace(stubPi),
					dir,
					undefined,
					{ rollbackOnError: true },
				),
				/does not exist/,
			);
			assert.equal(await exists(join(dir, "generated")), false);
		});
	});
});
