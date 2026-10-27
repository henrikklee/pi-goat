/**
 * Diff renderer — vendored substitution for upstream `diff.ts`.
 *
 * Upstream wraps the `diff` (jsdiff) npm package to produce a gutter-formatted
 * line diff. pi itself bundles the same jsdiff engine and exports a
 * behaviorally identical `generateDiffString` (same algorithm, same context
 * collapse rules, same `{ diff, firstChangedLine }` contract) from
 * `@earendil-works/pi-coding-agent`.
 *
 * We re-export pi's bundled implementation so multi-edit keeps its upstream
 * file layout (easy sync) while pi-goat stays free of external dependencies.
 */
export { generateDiffString } from "@earendil-works/pi-coding-agent";