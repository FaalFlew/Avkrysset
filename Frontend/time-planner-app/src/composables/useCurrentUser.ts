// src/composables/useCurrentUser.ts — the signed-in user's id, for "you" in org task wording.
//
// The access token (a JWT the API issues) carries the user id in its `sub` claim, so normally no
// request is needed. If the token can't be read, GET /api/users/me is asked once per session
// (keyed by the refresh token, which changes on every login) and cached.

import { computed, ref, type ComputedRef } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { apiDataService } from "@/services/apiDataService";

const NAME_IDENTIFIER = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";

/** The user id (`sub`) of a JWT access token, or null when it can't be read. */
export function userIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const id = claims.sub ?? claims[NAME_IDENTIFIER];
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/** Fallback cache: the profile id fetched for a session (refresh token). */
const fetched = ref<{ session: string; id: string } | null>(null);
let pendingSession: string | null = null;

function fetchProfileId(session: string): void {
  if (pendingSession === session) return;
  pendingSession = session;
  apiDataService
    .getMyProfile()
    .then((profile) => {
      if (pendingSession === session && profile.id) fetched.value = { session, id: String(profile.id) };
    })
    .catch(() => {
      if (pendingSession === session) pendingSession = null; // try again next time
    });
}

/** The current user's id (null for guests, or while the fallback request is pending). */
export function useCurrentUserId(): ComputedRef<string | null> {
  const auth = useAuthStore();
  return computed(() => {
    if (!auth.isAuthenticated) return null;
    const fromToken = userIdFromToken(auth.accessToken);
    if (fromToken) return fromToken;
    const session = auth.refreshToken ?? auth.accessToken ?? "";
    if (fetched.value?.session === session) return fetched.value.id;
    fetchProfileId(session);
    return null;
  });
}

/** Test hook: forget the cached profile id. */
export function resetCurrentUserCache(): void {
  fetched.value = null;
  pendingSession = null;
}
