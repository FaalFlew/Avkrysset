// src/components/auth/authErrors.ts — inline error copy for the auth forms.
//
// authStore.login/register catch their own errors and only return `false`, so the views cannot
// see why a request failed. Optional hook (read through a narrow cast, nothing required today):
// if authStore later exposes `lastError: { status?: number } | null` (set in the catch blocks),
// the copy below becomes precise (401 → wrong credentials, 409 → email taken, no status →
// network). Without it we fall back to the copy from the UI spec.

interface AuthErrorHook {
  lastError?: { status?: number | null } | null;
}

export const NETWORK_ERROR_COPY = "Can't reach the server. Check your connection and try again.";

function lastStatus(store: object): number | null | undefined {
  const hook = (store as AuthErrorHook).lastError;
  if (hook === undefined) return undefined; // hook not implemented
  return hook?.status ?? null;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function loginErrorMessage(store: object): string {
  if (isOffline()) return NETWORK_ERROR_COPY;
  const status = lastStatus(store);
  if (status === null) return NETWORK_ERROR_COPY;
  if (status !== undefined && status >= 500) return "Something went wrong on our side. Please try again.";
  return "Incorrect email or password.";
}

export function registerErrorMessage(store: object): string {
  if (isOffline()) return NETWORK_ERROR_COPY;
  const status = lastStatus(store);
  if (status === null) return NETWORK_ERROR_COPY;
  if (status === 409) return "An account with this email already exists. Try logging in instead.";
  return "We couldn't create your account. If you already have one, try logging in instead.";
}
