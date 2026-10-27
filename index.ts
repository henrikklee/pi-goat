/**
 * pi-goat — our curated suite of Pi extensions, vendored and decoupled from
 * upstream. Extension source is committed here; ordinary runtime libraries
 * are installed from package.json and package-lock.json. Pi supplies its
 * own core packages via virtual modules.
 *
 * Entry point discovered by Pi at ~/.pi/agent/extensions/pi-goat/index.ts.
 *
 * Bundled tools:
 *   - rewind / redo   : conversation-only undo/redo (our own; zero file access)
 *   - stash           : temporarily shelve the editor draft (vendored pi-stash)
 *   - multi_file_edit : preflighted exact replacements across files /
 *                       repeated occurrences (vendored pi-mono-extensions)
 *   - apply_patch     : Codex-style add/update/delete patches (same vendor)
 *   - web_search      : DuckDuckGo search (vendored pi-mono-extensions)
 *   - web_read        : page readability extraction (same vendor)
 *
 * NOTE: pi-undo (workspace undo) was vendored and then removed by decision —
 * it walks the full workspace tree at startup and mutates files on undo, which
 * is not wanted for this machine's workflow (conversation rewind only).
 *
 * Add your own tools / commands below (compose them into the exported factory).
 * Guard ctx.mode === "tui" for UI-only work, and don't collide with reserved
 * command names: /undo, /redo, /diff.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import stashExtension from "./stash/stash.ts";
import multiEditExtension from "./multi-edit/index.ts";
import webSearchExtension from "./web-search/index.ts";
import rewindExtension from "./rewind/rewind.ts";

export default function piGoat(pi: ExtensionAPI): void {
  // Conversation rewind / redo — no file system access.
  rewindExtension(pi);
  // Stash the current editor draft (Alt+S by default; configure pi-goat.shortcut).
  stashExtension(pi);
  // Additive editing tools: multi_file_edit + apply_patch.
  multiEditExtension(pi);
  // Web tools: web_search + web_read.
  webSearchExtension(pi);
}

// Keep each vendored module instantiable independently.
export { stashExtension, multiEditExtension, webSearchExtension, rewindExtension };