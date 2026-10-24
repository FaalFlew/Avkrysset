# Backlog — problems and ideas to solve later

Ordered by suggested timing. "Next" items should be done before Phase 3 (organizations frontend) starts.
Roadmap phases: `docs/plans/pdf-export-and-organizations.md`.

## Next (before Phase 3)

### 1. Bug: logging out during a cold start logs you back in (and can mix account data into guest data) — HIGH — DONE (feature/auth-session-race, live-verified 2026-10-24)
**Reported 2026-10-23.** Signed in but idle for hours (Azure has unloaded the API and the access token has expired). Creating a
task hangs on the cold start; the user logs out, starts using the guest planner, and is suddenly switched back to the account.
**Cause (confirmed in code):**
- The first request fails with 401 → `apiService.ts` starts a token refresh with the *old* refresh token (`authStore.handleTokenRefresh`).
- The user logs out meanwhile (`authStore.logout` → `_clearTokens`).
- When the server wakes up, the refresh succeeds and `_setTokens` writes the new tokens back to state + localStorage — nothing
  checks that the session it belonged to has ended → the app is signed in again. The original request is then retried.
- Side effect: responses that arrive after logout still mutate the stores (e.g. `taskStore.addTask` pushes the created task into
  whatever planner is showing — now the guest planner — and guest data is persisted to localStorage).
- Server side: if the logout call reaches the server before/after the refresh rotates tokens, the newly issued refresh token may
  never be revoked.
**Fix plan:**
- Session epoch in `authStore` (incremented on login, logout, clear); every request/refresh captures it; a refresh result or
  response from an old epoch is discarded (and the stray new refresh token revoked best-effort).
- Logout clears the local session immediately and calls the server logout in the background (don't wait for a cold server).
- On logout: abort in-flight requests (AbortController registry in `apiService`), reject the refresh queue, never retry them.
- Store actions check the epoch after every `await` before mutating state.
- UX: while the server wakes, show "Waking up the server…" for mutations too (the planner already does for loads); optional
  warm-up ping on app load when a session exists.
- Tests: refresh-during-logout race, response-after-logout, logout while the server is unreachable.
- Related infrastructure option: Azure App Service **Always On** removes cold starts (needs Basic tier or higher — a cost decision).

### 2. Smart default duration when creating a task in a gap — SMALL — DONE (feature/planner-quick-wins, 2026-10-24)
**Requested 2026-10-23.** Clicking/hovering a free slot always suggests 1 hour, even when only 30 minutes are free before the
next task. **Agreed rule:** default = min(1 hour, free time from the chosen start until the next task in that day column),
rounded down to the 15-minute grid, minimum 15 minutes. Applies to the hover preview, click-to-create and keyboard create (N);
drag-to-create keeps the dragged length. Count every visible task in the column (personal + assigned org tasks) since overlaps
with them are blocked. The editor's duration chips stay available to pick longer (the overlap check still applies).
**Done:** `src/lib/newTaskDuration.ts` — the next task counts even on a later day; < 15 min free keeps 15 min with a note in
the editor ("Only 10 min free before “Standup”."). Also N/C, the FAB and Today's "Add task". Today's free-gap button still
fills the gap up to 1 hour unrounded (unchanged).

### 3. Copy and paste tasks — SMALL–MEDIUM — DONE (feature/planner-quick-wins, 2026-10-24)
Ctrl/⌘ C on a focused task → Ctrl/⌘ V on a chosen slot (keeps title, duration, category, template); phones: long-press menu
"Copy" → tap a slot → "Paste here"; "Duplicate to next day/week". Normal overlap rules; copying a read-only org task creates a
personal copy. Do together with item 2 ("planner quick wins") or as the first part of Phase 3 (so it works in the org schedule too).
**Done:** Ctrl/⌘+C / Ctrl/⌘+V (pointer slot → after the focused task → selected day), right-click menu (Copy, Duplicate to
next day/week, Paste here), editor "More actions" (Copy → "Tap a time to paste" banner, Duplicate) for phones. Copies are
always personal tasks (org tasks I created too — no org-create step in the planner yet; revisit in Phase 3's org schedule).
Undo toast deletes the copy; the copy is session-bound (`stores/clipboardStore.ts`). Phones use the editor menu instead of a
long-press menu (long-press stays drag).

## Later

### 4. Task dots on the phone week strip for every week — SMALL (decision pending)
Dots currently show only for the loaded week (signed-in mode loads one week at a time). Needs a lightweight
"days with tasks in range" endpoint. Owner to decide if worth it.

### 5. Projects → "solo workspaces" built on organizations — PHASE 5 (after Phases 3–4)
A blank planner per project = an organization with one member where team features stay hidden until someone is invited,
plus organization-level categories and templates (plan decision Q2 "later"). Open product question: separate pages vs one
calendar filtered by project (one calendar catches double-bookings across projects).

### 6. Phase 4 prerequisite: `ReportExports.Kind` is `nvarchar(16)`
"OrganizationTasks" (17 chars) won't fit — widen the column in Phase 4's migration or use a shorter Kind.

### 7. Small pre-existing issues found during reviews — SMALL
- Creating a category with a duplicate name returns 500 instead of a readable 409/400 (unique index violation).
- `CreateTask` / `UpdateTask` verify that the category belongs to the user but not the `TemplateId`: a user can reference another
  user's template id, whose title then appears in their own analytics/report template breakdown (small info leak). Validate
  template ownership (the frontend only sends the user's own template ids since the copy/paste work).
- The API logs "Confirmation email sent" even when no Postmark token is configured (nothing is sent; misleading log).
- The CSV formula-injection guard doesn't treat a leading `\r` as dangerous (client and server).
- Report CSVs requested without `locale` fall back to invariant labels ("2026 January – 2026 December"); the app always sends
  `locale`, so only direct API users see it.

### 8. Auth hardening found while fixing item 1 — SMALL–MEDIUM
- ~~Refresh exact token match, race-safe refresh save, previous-token grace period~~ — DONE in `feature/auth-session-race`
  (2026-10-24; see `docs/plans/auth-session-race.md` "Refresh grace period").
- Login ignores a failed `UserManager.UpdateAsync` result; login and refresh have no rate limiting.
- Every token lookup scans `AspNetUsers` (`RefreshToken` is `nvarchar(max)`, unindexed) — store a hash in an indexed column.
- One refresh token per user: signing in on a second device signs the first one out on its next refresh (design decision to
  revisit if multi-device use matters).
- Per-IP rate limits depend on the client IP reaching the app; on Azure configure forwarded headers so users don't share a bucket.
- Access-token lifetime is hard-coded (15 min in `TokenService.cs`) and JWT `ClockSkew` is the 5-minute default, so expired tokens
  are accepted for up to 5 extra minutes — make the lifetime configurable and use a small ClockSkew (e.g. 30 s).

## Housekeeping
- Move secrets from the deployed `appsettings.Secrets.json` to Azure App Settings (long-term, cleaner).
- Confirm production doesn't use the old JWT secret that is visible in the public repo's early history.
- EF execution-strategy retries can double-commit if a commit's outcome is unknown (consider `verifySucceeded`).
