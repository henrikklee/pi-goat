/**
 * Multi-file editing tools for pi.
 *
 * Pi's native `edit` tool remains active for normal single-file edits. This
 * extension adds only the capabilities that native edit does not provide:
 * cross-file replacement batches and Codex-style patches.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { applyClassicEdits } from "./classic.ts";
import { applyPatchOperations, parsePatch } from "./patch.ts";
import type { EditItem } from "./types.ts";
import { createRealWorkspace, createVirtualWorkspace } from "./workspace.ts";

const editItemSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description:
          "Path to the file to edit (relative or absolute). Inherits from the top-level path when omitted.",
      }),
    ),
    oldText: Type.String({
      description: "Exact text to find and replace (must match exactly)",
    }),
    newText: Type.String({
      description: "New text to replace the old text with",
    }),
  },
  { additionalProperties: false },
);

export const multiFileEditSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description: "Default path inherited by edits that omit path",
      }),
    ),
    edits: Type.Array(editItemSchema, {
      minItems: 2,
      description:
        "Two or more exact replacements spanning multiple files or targeting repeated identical occurrences in one file. Repeat an identical edit entry once per occurrence to replace.",
    }),
  },
  { additionalProperties: false },
);

export const applyPatchSchema = Type.Object(
  {
    patch: Type.String({
      description:
        "Codex-style patch payload delimited by *** Begin Patch and *** End Patch",
    }),
  },
  { additionalProperties: false },
);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "multi_file_edit",
    label: "multi_file_edit",
    description:
      "Apply a preflighted batch of exact replacements across multiple files or to repeated identical occurrences in one file. Use native edit for ordinary unique same-file replacements.",
    promptSnippet:
      "Apply exact replacements across multiple files or repeated identical occurrences in one file",
    promptGuidelines: [
      "Use native edit for ordinary one-file changes whose oldText values are unique, including multiple disjoint replacements",
      "Use multi_file_edit when exact replacements span multiple files and should be preflighted together",
      "Use multi_file_edit instead of native edit when the same oldText must be replaced at multiple occurrences in one file; repeat the identical edit entry once per intended occurrence",
      "Set a top-level path when several edits target the same file; individual edits may override it",
    ],
    parameters: multiFileEditSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const edits: EditItem[] = params.edits.map((item) => ({
        path: item.path ?? params.path ?? "",
        oldText: item.oldText,
        newText: item.newText,
      }));

      for (let i = 0; i < edits.length; i++) {
        if (!edits[i].path) {
          throw new Error(
            `Edit ${i + 1} is missing a path. Provide a path on the edit or set a top-level path to inherit.`,
          );
        }
      }

      try {
        await applyClassicEdits(
          edits,
          createVirtualWorkspace(ctx.cwd),
          ctx.cwd,
          signal,
          { collectDiff: false },
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Preflight failed before mutating files.\n${message}`);
      }

      const results = await applyClassicEdits(
        edits,
        createRealWorkspace(pi),
        ctx.cwd,
        signal,
        {
          collectDiff: true,
          rollbackOnError: true,
          continueOnError: edits.length > 1,
        },
      );

      const succeeded = results.filter((result) => result?.success);
      const failed = results.filter((result) => result && !result.success);
      const summary = results
        .map((result, index) => `${index + 1}. ${result.message}`)
        .join("\n");
      const combinedDiff = results
        .filter((result) => result?.diff)
        .map((result) => result.diff)
        .join("\n");
      const firstChangedLine = results.find(
        (result) => result?.firstChangedLine !== undefined,
      )?.firstChangedLine;
      const statusLine =
        failed.length > 0
          ? `Applied ${succeeded.length}/${results.length} edit(s). ${failed.length} failed:\n${summary}`
          : `Applied ${results.length} edit(s) successfully.\n${summary}`;

      return {
        content: [{ type: "text" as const, text: statusLine }],
        details: { diff: combinedDiff, firstChangedLine },
      };
    },
  });

  pi.registerTool({
    name: "apply_patch",
    label: "apply_patch",
    description:
      "Apply a preflighted Codex-style patch that can add, update, or delete files. Missing parent directories are created automatically when adding files. Use native edit for ordinary replacements.",
    promptSnippet:
      "Apply a Codex-style patch for coordinated add, update, or delete operations",
    promptGuidelines: [
      "Use native edit for ordinary single-file replacements",
      "Use apply_patch for coordinated multi-file changes or file additions/deletions",
      "Add files directly at their intended nested paths; apply_patch creates missing parent directories automatically",
      "Patch payloads must use *** Begin Patch and *** End Patch delimiters",
    ],
    parameters: applyPatchSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const operations = parsePatch(params.patch);

      await applyPatchOperations(
        operations,
        createVirtualWorkspace(ctx.cwd),
        ctx.cwd,
        signal,
        { collectDiff: false },
      );

      const applied = await applyPatchOperations(
        operations,
        createRealWorkspace(pi),
        ctx.cwd,
        signal,
        { collectDiff: true, rollbackOnError: true },
      );
      const summary = applied
        .map((result, index) => `${index + 1}. ${result.message}`)
        .join("\n");
      const combinedDiff = applied
        .filter((result) => result.diff)
        .map((result) => `File: ${result.path}\n${result.diff}`)
        .join("\n\n");
      const firstChangedLine = applied.find(
        (result) => result.firstChangedLine !== undefined,
      )?.firstChangedLine;

      return {
        content: [
          {
            type: "text" as const,
            text: `Applied patch with ${applied.length} operation(s).\n${summary}`,
          },
        ],
        details: { diff: combinedDiff, firstChangedLine },
      };
    },
  });
}
