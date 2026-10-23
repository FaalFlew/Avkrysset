# Spec: cold-start logout race (backlog item 1)

Status: **APPROVED 2026-10-24.** Branch `feature/auth-session-race` (from `development`). Conventions: `CLAUDE.md`.

## The bug (owner report, confirmed in code)
Signed in but idle for hours: Azure has unloaded the API and the access token has expired. The user creates a task (request
hangs on the cold start), logs out, starts using the guest planner — and is suddenly signed back into the account.
- Frontend: the first request gets 401 → `services/apiService.ts` refreshes with the *old* refresh token
  (`authStore.handleTokenRefresh`). Meanwhile the user logs out (`authStore.logout` → `_clearTokens`). When the server wakes, the
  refresh succeeds and `_setTokens` writes the new tokens back to state + localStorage — nothing checks that the session ended.
  The original request is retried and its result mutates whatever is on screen (e.g. `taskStore.addTask` pushes the account's
  task into the guest planner, which is then persisted to guest localStorage).
- Backend: `POST /api/auth/logout` is `[Authorize]` (`Controllers/AuthController.cs:103`). With an expired access token it returns 401,
  so `LogoutCommandHandler` never clears `User.RefreshToken` — the session stays valid server-side after the user "logged out".
  (The server stores ONE refresh token per user on `User.RefreshToken` / `RefreshTokenExpiryTime` — pre-existing; keep it.)

## Fix — backend (TimePlanner.API)
1. Logout works without a valid access token: `POST /api/auth/logout` accepts an optional body `{ refreshToken }` and is no longer
   `[Authorize]`. It revokes when EITHER the caller is authenticated (current behaviour) OR the supplied refresh token matches
   the stored one for some user (constant-time compare; look up by token). Always returns 204 (no information leak); never 401.
   Rate-limit sensibly (reuse the auth rate limiting if present, else a small per-IP limiter).
2. `GET /api/health` (anonymous, cheap, no DB) → 204, used by the frontend to start waking the server early.
3. Tests: logout with expired access token + matching refresh token → revoked (a later refresh with it fails); wrong/missing
   token → 204 and nothing changes; authenticated logout still works; health endpoint; refresh after revoke → 401.

## Fix — frontend (Frontend/time-planner-app)
1. **Session epoch** in `authStore`: a number incremented on login, logout and session clear. The request interceptor stamps each
   request with the current epoch.
2. **Refresh guard:** `handleTokenRefresh` captures the epoch; if it changed before the refresh resolves, DISCARD the new tokens
   (never `_setTokens`), best-effort revoke the stray refresh token (`POST /auth/logout {refreshToken}` fire-and-forget), and
   reject the waiting requests.
3. **Stale responses:** a response (or retry) belonging to an older epoch is rejected with a typed `SessionChangedError` before
   any caller sees it — stores must not mutate state for it; callers treat it as silent (no error toast).
4. **Logout is instant:** clear the local session immediately (switch to guest), then call the server logout in the background
   with the refresh token being discarded (anonymous endpoint) — never wait for a cold server. Abort in-flight requests of the
   old epoch (AbortController registry in `apiService`), reject the refresh queue, never retry them.
5. **Cold-start UX:** reuse the "Waking up the server…" pattern for MUTATIONS (create/update/delete) when a request takes > 3 s
   (non-blocking indicator), and on app load / tab return after long idle with a stored session, ping `GET /api/health` to start
   waking the server, and refresh an expired access token in the background before the user acts.
6. Guest data must never receive account data: belt-and-braces check in the guest persistence path.

## Tests
- Frontend unit: refresh resolves after logout → tokens not restored, stray token revoked, queued requests rejected; response
  after logout → `SessionChangedError`, store unchanged; logout while the server is unreachable → instant guest mode;
  login → logout → login epochs; mutation slow indicator; health ping on load/visibility.
- Live review: reproduce the owner's scenario against a local API whose responses are delayed/suspended (simulated cold start):
  expired access token → create task → log out → create guest task → server wakes → the app stays in guest mode, the guest task
  is intact, no account data appears in guest storage, and the server-side refresh token is revoked.
