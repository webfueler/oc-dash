import type { SessionInfo } from "../src/api"

/**
 * The session factory the tree, filters, summary and widget tests share.
 *
 * It used to live in `tree.test.ts` and be imported from there, which is
 * how 24 tests ended up collected and run three extra times: importing a
 * test file executes its `describe` blocks inside the importing file's
 * collector, so `src/widget.test.ts` reported 51 tests when it held 27.
 *
 * A plain module rather than a test file is the fix. It is imported by
 * four `*.test.ts` files and by nothing else, so it never reaches either
 * Vite entry and only `tsc --noEmit` and eslint ever see it.
 */
export function sess(partial: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    projectID: "proj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/tmp/proj" },
    ...partial,
  }
}
