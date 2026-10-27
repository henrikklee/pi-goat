# Vendored extension source

These extension implementations are maintained inside pi-goat. None is loaded
from an upstream repository at runtime. Do not replace them with upstream
package dependencies or synchronize them automatically.

## multi-edit and web-search

Source: https://github.com/emanuelcasco/pi-mono-extensions
Paths: `extensions/multi-edit`, `extensions/web-search`, and the small
`pi-common/tool-result` helper inlined as `web-search/src/tool-result.ts`.

License: MIT; notice preserved in `LICENSES/pi-mono-extensions-MIT.txt`.
Upstream calls its license file `LICENCE.md`.

Known source reference: `78e39a8d939276bde2459801df3b2e7bdceec62d`.
The local upstream checkout at this commit was used to verify provenance;
`multi-edit/classic.ts` matches its Git blob exactly
(`9a17ad91b3b87291e9aa895b290318d80226d05e`).
The original import did not record a full source revision, so this reference
is not a claim that every vendored file is an unchanged copy of that revision.

Retained adaptations include:
- Separate additive `multi_file_edit` and `apply_patch` tools.
- Diff generation supplied by Pi rather than an extra jsdiff dependency.
- Nested add-file parent creation and rollback cleanup.
- `linkedom` instead of jsdom; raw href attributes preserve URL encoding.
- Inlined tool-result helper.
- Web URL validation, private-network checks, redirect checks and response
  size limits. These existing local protections have not been replaced.

Only the extension source is vendored. Runtime libraries are ordinary npm
dependencies: `linkedom@0.18.13` (MIT) and `@mozilla/readability@0.6.0`
(MPL-2.0), with their transitive closure recorded in `package-lock.json`.
Their installed packages supply their own source and license notices.

## stash

Source: https://github.com/maxpetretta/pi-stash
Recorded import: `v0.2.0`, upstream commit
`f97ad44fd9065e8d4b4ce01a1870ec8129dc8d5a`.

License: MIT; notice preserved in `LICENSES/pi-stash-MIT.txt`.
The local copy includes Pi import/keybinding namespacing and local filesystem
handling. Preserve these adaptations when considering a manual update.

## rewind / redo

Original pi-goat implementation using Pi's session tree, not workspace Git
snapshots. Concept inspired by https://github.com/DavidEasden/pi-undo;
no pi-undo implementation is included.

## Manual updates

Compare a specific upstream commit against the committed source. Review each
change, preserve local adaptations and notices, record the reviewed revision,
and run the tests. Ordinary dependency updates are separate, explicit
package.json/lockfile changes. Upstream repositories are not needed to run
the copied extensions.
