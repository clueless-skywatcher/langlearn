import { apiStore } from "./api";
import { browserStore } from "./browser";
import type { ProgressStore, StoreKind } from "./types";

export * from "./types";
export { attemptsOf, latestMistakes, rollUpProgress, setOf } from "./rollup";

/**
 * Which store this build uses, fixed at build time by
 * `NEXT_PUBLIC_LANGLEARN_STORE`.
 *
 * The default is **browser**, because it is the mode that works everywhere:
 * no database, no writable disk, no service to provision. Set the variable to
 * `sqlite` to keep progress on the server instead, which needs a host that
 * gives you a real filesystem and Node 23.4 or later.
 */
export const STORE_KIND: StoreKind =
  process.env.NEXT_PUBLIC_LANGLEARN_STORE === "sqlite" ? "sqlite" : "browser";

/** True when the server is expected to persist what it grades. */
export const SERVER_PERSISTS = STORE_KIND === "sqlite";

/**
 * The store the UI talks to. Both implementations run in the browser: one
 * writes to localStorage, the other calls the server's API.
 */
export function progressStore(): ProgressStore {
  return STORE_KIND === "sqlite" ? apiStore : browserStore;
}
