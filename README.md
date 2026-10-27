# pi-goat

A locally maintained collection of Pi extensions:

- `/rewind` and `/redo`: conversation-only rewind; no workspace restoration.
- `Alt+S`: stash an editor draft and restore it after the next prompt.
- `multi_file_edit` and `apply_patch`: preflighted multi-file editing.
- `web_search` and `web_read`: DuckDuckGo search and article extraction.

## Install

Requires Pi and Node.js 22.19 or newer.

```sh
pi install git:github.com/henrikklee/pi-goat
```

Pi installs ordinary runtime dependencies. Pin the Git source to a reviewed
commit to prevent package updates from moving it.

For a local checkout, run `npm ci --ignore-scripts` in this directory,
then load it with `pi -e ./index.ts`. Local dependencies must be installed
even when the directory is discovered under `~/.pi/agent/extensions/`.

## Dependency policy

Extension implementations are committed source, not upstream dependencies.
They cannot change or disappear when their original repositories change.
Updates are deliberate manual changes reviewed here.

Normal libraries (`linkedom` and `@mozilla/readability`) are installed through
npm, with exact direct versions and a committed lockfile. For a reproducible
checkout install, use `npm ci --ignore-scripts`. Their availability still depends
on the package registry/cache; this is not an offline dependency archive.
Host-provided Pi packages are optional peers and are not bundled.

## Development

```sh
npm ci --ignore-scripts
bun test
```

Bun is required for tests. Web tests use fixtures; they do not query search
engines or fetch public pages.

## Privacy and behavior

No API keys are required. Search queries go to DuckDuckGo; page reads contact
the requested website. Web results are untrusted input.
Draft stashes are stored at `<cwd>/.pi/stash.md`; do not commit that file.
The stash shortcut can be configured as `pi-goat.shortcut` in Pi keybindings.

## Licenses and provenance

See [VENDORED.md](VENDORED.md) and [LICENSES/](LICENSES/).
Original pi-goat contributions are MIT licensed. Third-party source retains
its original notices; installed libraries retain their own licenses.
