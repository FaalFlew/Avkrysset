// src/lib/crossTabLock.ts — run a task while holding a lock shared by every tab of the app
// (Web Locks API). Used to serialise token refreshes: tabs share one refresh token, and two tabs
// refreshing it at the same moment could sign the user out of all of them.

/** The lock every tab takes around a token refresh. */
export const TOKEN_REFRESH_LOCK = "tp-token-refresh";

/** The part of the Web Locks API used here (navigator.locks). */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** navigator.locks, or null where it is missing (old browsers, insecure http origins). */
export function crossTabLocks(): LockManagerLike | null {
  const locks = (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks;
  return locks && typeof (locks as LockManagerLike).request === "function" ? (locks as LockManagerLike) : null;
}

/**
 * Run `task` holding the exclusive lock `name` across all tabs (released when it settles, or when
 * the tab closes). Without the Web Locks API the task simply runs (best effort, as before).
 */
export function withCrossTabLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = crossTabLocks();
  return locks ? locks.request(name, () => task()) : task();
}
