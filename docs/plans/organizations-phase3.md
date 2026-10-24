# Phase 3 — Organizations frontend + backend support (implementation spec)

Status: **PLAN, 2026-10-24.** This replaces §5 of `pdf-export-and-organizations.md` and checks it against the code at `6ea08e3`
(`feature/organizations`). D1–D9 and Q1–Q16 there are approved and still apply; this file doesn't repeat them. Line references are
to `6ea08e3`.
How to read it: find your sub-phase in §5, then read the §2/§3 contracts it touches, then §6 (permissions) and §7 (tests).

---

## 1. Current state

### 1.1 Backend
| Area | State | Where |
|---|---|---|
| Org CRUD, codes, members, roles, transfer, leave, org tasks, board, invite, accept by token | Exist. The 404/403 helpers are used everywhere (non-member → 404, Q4) | `Utilities/AuthorizationExtensions.cs:57-105` |
| Phase 1: org `TimeZoneId`, user `DisplayName`, D7 planner scope, `TaskItemDto` org fields + `capabilities` | Done | `OrganizationsController.cs:30-44`, `Queries/Tasks/PlannerScope.cs`, `TaskProjections.cs:83-104` |
| `GET …/tasks/{taskId}` | **Stub** (200 + message; it is the `CreatedAtAction` target) | `OrganizationsController.cs:146-151` |
| `GET /api/invitations/{id}` | **Stub** (the known CS1998) | `InvitationsController.cs:32-39` |
| `OrganizationDto` | No `myRole`. Codes are `"hidden"` for everyone except the owner, but Q8 says admins see them. The hub payload sends `""` codes | `GetOrganizationById.cs:54-58`, `GetMyOrganizations.cs:49-55`, `UpdateOrganization.cs:74-80` |
| Member list / join codes | Admin+Owner only / Owner only | `GetOrganizationMembers.cs:33`, `GetJoinCodes.cs:29` |
| `GET …/members/me` | Returns Left/Removed memberships as 200 | `GetMyMembership.cs:33-46` |
| Org + member analytics | Raw `startDate/endDate`. No zone, no breakdown, no years. The member DTO has no display name. `totalHours` counts task-hours; `timePerMember` counts person-hours (undocumented) | `GetOrganizationAnalytics.cs`, `GetMemberAnalytics.cs` |
| Activity | Derived from Tasks + Memberships only. The update actor is the creator (wrong). Every membership row reads "Joined". No `before`; `limit` unbounded; members see every task title (conflicts with Q6) | `GetOrganizationActivity.cs:40-41, 77-89, 102` |
| Invitations | No preview, decline, list, rescind or by-id. The email link is `/accept-invite?token=`. The org name isn't HTML-encoded. A duplicate pending invite → 500 (filtered unique index). An expired invite stays `Pending` and blocks re-inviting (500) | `InviteUser.cs:81-93`, `ApplicationDbContext.cs:312-313` |
| **Bug** | If an already-active member accepts an invitation, their role is overwritten. An admin gets demoted; a new owner can become `Member` while `Organizations.OwnerId` still points at them | `AcceptInvitation.cs:71-75` |
| **Bug (security)** | `DeleteIssue` finds the issue by panel + id only, so an admin of org A can delete org B's issue | `DeleteIssue.cs:38` |
| Board | `IssueDto` has no `categoryColor` or `convertedToTaskId`; panels are unordered. `MoveIssue` moves converted issues. A duplicate panel name → 500; `UpdateIssuePanel` has no validator. `UpdateIssue` demands the editor's own category even when it is unchanged (the Q2 fix wasn't applied to issues) | `GetIssueBoard.cs:40-62`, `MoveIssue.cs:54`, `CreateIssuePanel.cs:53`, `UpdateIssuePanel.cs:13`, `UpdateIssue.cs:77` |
| Small bugs | Duplicate `assigneeIds` → misleading 400. `UpdateMemberRole` accepts a Left/Removed target. Re-joining by code sends no `MemberJoined` | `CreateOrganizationTask.cs:78`, `PromoteIssueToTask.cs:83`, `UpdateMemberRole.cs:52`, `JoinOrganization.cs:88-97` |
| SignalR | The JWT is never read from `access_token` (`Program.cs:96-108`). Groups come from JWT claims at connect (`OrganizationHub.cs:12-30`, `TokenService.cs:62`): stale for up to 15 min, and removed members keep receiving. **Every task event goes to every member** (`SignalROrganizationNotifier.cs:24-31`), which breaks Q6. No `OrganizationDeleted`, no task events for the hard delete in `RemoveMember.cs:86-95`, no invitation events | |
| Org delete with issues | The DB path Org→Panels→Issues cascades (`ApplicationDbContext.cs:261-279`); Issue→Org is `ClientCascade` (:297). Untested | |
| Tests / build | A 403/404 matrix exists (`Integration/OrganizationPermissionTests.cs:23-77`). The fixture swaps the notifier for `RecordingNotificationService` (`TestDoubles.cs:11`). Build: 0 errors, 1 warning (CS1998) | |

### 1.2 Frontend
| Area | State | Where |
|---|---|---|
| Org tasks in My planner (D7) | Done: monogram badge, read-only editor with "Assigned by …", saves and deletes through the org endpoints, Undo re-creates org tasks | `TaskBlock.vue:126`, `lib/taskAccess.ts`, `stores/taskStore.ts:731`, `apiDataService.ts:206-259` |
| 403 | `onForbidden()` exists, but **nothing subscribes** | `services/apiService.ts:158-186` |
| Org routes, views, store, service, context switcher, `/settings`, `/invitations` | **Missing** | `router/index.ts:28-83` |
| Profile | Only `getMyProfile` (used as a user-id fallback). Nothing calls `PUT /users/me` | `apiDataService.ts:261-271` |
| Navigation | `NAV_ITEMS` is static; hotkeys 1–4 are bound once; the tab bar is a fixed 5-column grid | `navItems.ts:17-22`, `App.vue:114-116`, `AppTabBar.vue:55` |
| Auth guard | Sends to `/login` with no return path; login always goes to `/` | `router/index.ts:93`, `LoginView.vue:73` |
| Planner | `WeekView` reads `taskStore` directly (`WeekView.vue:152, 255, 283, 363`). One global editor saves through `useTasks()` (`TaskEditor.vue:70`). Drag/keyboard already take injected `tasks/commit/canDrag` (`useTaskDragAndDrop.ts:71-100, 819-831`) | |
| Copy/paste | A copy is always personal | `lib/taskClipboard.ts:3-8` |
| Analytics | Filter state lives inside `TaskAnalytics.vue:38-106`. The charts take an `AnalyticsSnapshot` (`useStats.ts:75-93`). The selection builder exists (`lib/reportQuery.ts:43-52`) | |
| Dependency | `@microsoft/signalr` isn't installed (approved, Q12) | |

---

## 2. API contracts

Conventions: every route is under `/api` and uses camelCase. Every instant is `yyyy-MM-ddTHH:mm:ss.fffZ` (`UtcDateTimeJsonConverter`). Errors are
`{ message, errors[] }`. Signed out → 401 (except `anon` rows). A non-member (never joined, left, removed, or no such org) → **404
"Organization not found."** on any `/organizations/{id}/…` route. An active member without the role → **403** with a reason. Body
ids must match the route (existing 400). Who: **O** Owner, **A** Admin, **M** Member (active), **user** any signed-in user,
**anon** no token needed. Δ: **N** new, **C** changed, **E** existing (contract confirmed).
Query `DateTime` binding gives `Kind=Local`, so call `.ToUniversalTime()` before comparing in memory (EF parameters are already
converted).

### 2.1 DTOs (TypeScript notation; `Instant` = UTC string with Z)
```ts
type Role = "Owner" | "Admin" | "Member";
OrganizationDto {                       // C
  id; name; ownerId; timeZoneId /* IANA */;
  color: string;                        // N: OrganizationPalette.ColorFor(id), the colour personal analytics already uses
  myRole: Role | null;                  // N: null only in hub payloads
  memberJoinCode: string | null; memberJoinCodeExpiryUtc: Instant | null;   // C: non-null only for O/A (Q8); null replaces "hidden"
  adminJoinCode: string | null;  adminJoinCodeExpiryUtc: Instant | null;
}
MembershipDto /*OrganizationMembershipDto, E*/ { membershipId; organizationId; organizationName; userId; userEmail;
  displayName /*falls back to email*/; role: Role; status: "Active"|"Left"|"Removed"; statusMessage: string|null }
SelectableMemberDto /*E*/ { userId; userEmail; displayName }
JoinCodesDto /*E*/ { organizationId; memberJoinCode; memberJoinCodeExpiryUtc; adminJoinCode; adminJoinCodeExpiryUtc }
InvitationDto /*OrganizationInvitationDto, C*/ { id; organizationId; organizationName; invitedUserEmail; role: "Admin"|"Member";
  status; expiryUtc; invitedByDisplayName /*N*/; createdOnUtc /*N*/ }
InvitationPreviewDto /*N*/ { organizationId; organizationName; role; invitedByDisplayName;
  invitedEmailMasked /* "m•••@gmail.com": first character + ••• + @domain */;
  status: "Pending"|"Accepted"|"Declined"|"Rescinded"|"Expired" /* Pending past expiry reads "Expired" */; expiryUtc;
  matchesCurrentUser: boolean | null /* null when signed out */ }
TaskItemDto /*E*/ — as today (src/types `Task`); `capabilities` is null only in hub payloads
IssueDto /*C*/ { id; title; notes: string|null; categoryId; categoryName; categoryColor /*N*/; organizationId; issuePanelId;
  convertedToTaskId: string|null /*N*/; createdOnUtc /*N*/ }
IssuePanelDto /*E*/ { id; name; organizationId }
IssueBoardDto /*C*/ { organizationId; organizationName; panels: { id; name; issues: IssueDto[] }[] }
  // panels ordered by createdOnUtc then name (ordinal); issues by createdOnUtc then id
OrgAnalyticsDto /*C*/ {
  organizationId; timeZoneId; timeZoneLabel /* ReportFormatting.ZoneLabel: "America/New_York (UTC-04:00/-05:00)" */;
  view: "monthly"|"weekly"|"daily"; rangeStartUtc: Instant; rangeEndUtc: Instant;  // half-open, resolved in the ORG zone
  totalHours: number;     // Σ durations, each task counted once
  assignedHours: number;  // Σ per assignment (person-hours) = Σ timePerMember
  taskCount: number;
  timePerCategory: { categoryId; categoryName; categoryColor; totalHours }[];             // AnalyticsOrder.Sort
  timePerMember: { memberId; displayName; memberEmail; memberStatus; totalHours }[];      // hours desc, name, id; includes former members
  breakdownData: { key; label; value; dominantCategoryColor }[];  // ZERO-FILLED: every bucket of the selection in order (EnumerateBuckets)
}
MemberAnalyticsDto /*C*/ = OrgAnalyticsDto without assignedHours/timePerMember, plus { memberId; displayName; memberEmail; memberStatus }
ActivityPageDto /*C (was a bare array)*/ { items: ActivityItemDto[]; nextBefore: Instant | null }
ActivityItemDto { id: string /* stable, e.g. "task:{id}:created" */; timestamp: Instant; actorUserId: string|null;
  actorDisplayName: string|null; actorUserEmail: string|null;
  actionType: "Created"|"Updated"|"Joined"|"Left"|"Removed"|"Exported";
  entityType: "Organization"|"Task"|"Issue"|"Member"|"Report"; entityId: string|null; description: string /* English fallback */ }
ProfileDto /*E*/ { id; email; displayName: string|null }
```

### 2.2 Organizations, codes, profile
| Δ | Route | Body / query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `POST /organizations` | `{name ≤150, timeZoneId?}` → 201 `OrganizationDto` (myRole Owner, codes set) | 400, 409 name taken | user |
| C | `GET /organizations/{id}` | → 200 `OrganizationDto` | 404 | O A M |
| C | `GET /users/me/organizations` | → 200 `OrganizationDto[]`, active memberships, by name | — | user |
| E | `PUT /organizations/{id}` | `{organizationId, name, timeZoneId?}` → 204 | 400 zone, 403, 409 name | O A |
| E | `DELETE /organizations/{id}` | → 204 | 403 | O |
| E | `POST /organizations/join` | `{joinCode}` (8 chars; the client uppercases it and strips spaces) → 200 `MembershipDto` | 400 expired, 404 invalid code, 409 already active | user |
| C | `GET /organizations/{id}/join-codes` | → 200 `JoinCodesDto` | 403 for M | O A (Q8) |
| E | `POST /organizations/{id}/regenerate-codes` | `{organizationId, expiryDays 1–365}` → 200 `OrganizationDto` | 400, 403 | O |
| E | `GET /users/me` / `PUT /users/me` | `{displayName}` (trimmed, ≤100; empty clears) → 200 `ProfileDto` | 400 | user |

### 2.3 Members
| Δ | Route | Body / query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `GET /organizations/{id}/members` | → 200 `MembershipDto[]` by display name. **O/A: every status; M: Active only** (the "limited" directory: the email stays because the display name falls back to it anyway) | 404 | O A M |
| C | `GET /organizations/{id}/members/me` | → 200 `MembershipDto` | **404 unless Active** | O A M |
| E | `GET /organizations/{id}/members/selectable` | → 200 `SelectableMemberDto[]` (Active) | 403 | O A |
| C | `PUT /organizations/{id}/members/{userId}/role` | `{organizationId, userId, newRole: "Admin"\|"Member"}` → 204 | 400 owner target, 403 (A demoting A), **404 target not Active** | O A |
| E | `DELETE /organizations/{id}/members/{userId}?hardDeleteTasks=false` | → 204 (idempotent) | 409 owner target, 403 | O A (see §8 Q-E) |
| E | `POST /organizations/{id}/members/me/leave` | → 204 | 409 owner | A M |
| E | `PUT /organizations/{id}/members/me/settings` | `{organizationId, statusMessage ≤150 \| null}` → 204 | 400 | O A M |
| E | `POST /organizations/{id}/transfer-ownership` | `{organizationId, newOwnerUserId}` → 204 (target must be an active Admin) | 400, 403 | O |

### 2.4 Invitations
| Δ | Route | Body / query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `POST /organizations/{id}/invitations` | `{organizationId, email, role}` → 201 `InvitationDto` | 400, 403, **409 already active / unexpired pending invite** | O A |
| N | `GET /organizations/{id}/invitations` | → 200 `InvitationDto[]` pending + unexpired, newest first | 403 | O A |
| N | `DELETE /organizations/{id}/invitations/{inviteId}` | → 204, status → `Rescinded` | 404 not in this org, 409 not pending | O A |
| C | `GET /users/me/invitations` | → 200 `InvitationDto[]` (inbox: pending, unexpired, my email) | — | user |
| N | `GET /invitations/{inviteId:guid}` | → 200 `InvitationDto` (replaces the stub) | 404 unless invitee or O/A of that org | user |
| N | `GET /invitations/{token}` | → 200 `InvitationPreviewDto` | 404 unknown token | **anon** |
| C | `POST /invitations/{token}/accept` | → 200 `MembershipDto` | 400 expired, 404 wrong user/unknown, 409 not pending | user |
| N | `POST /invitations/{token}/decline` | → 204 | 400 expired, 404, 409 not pending | **anon** (the token is the secret, §8 Q-F) |
| N | `POST /invitations/{inviteId:guid}/accept` | → 200 `MembershipDto` (inbox, email must match) | as token accept | user |
| N | `POST /invitations/{inviteId:guid}/decline` | → 204 | 404, 409 | user |

Rules (3A):
- Accept when already Active: mark the invitation Accepted, **leave the role unchanged**, return 200 with the current membership
  (fixes the owner-corruption bug).
- Invite: first mark the same org+email's expired `Pending` rows `Expired` (unblocks the filtered unique index). Then return 409
  if an unexpired pending invite exists. Normalize the email with `Trim()`.
- The email link becomes `{FrontendBaseUrl}/invitations/{token}`. HTML-encode the org name and role in the body.
- Routing: tokens are 43-character base64url strings and never GUID-shaped. The `:guid`-constrained routes win for ids — cover
  both in tests.

### 2.5 Org tasks (schedule)
| Δ | Route | Body / query → 2xx | Errors | Who |
|---|---|---|---|---|
| E | `GET /organizations/{id}/tasks?startDate&endDate&memberId?` | half-open UTC range → 200 `TaskItemDto[]` by start, with capabilities. **M: forced to own assignments** (Q6) | 400 | O A M |
| N | `GET /organizations/{id}/tasks/{taskId}` | → 200 `TaskItemDto` | 404; **M: 404 unless assignee or creator** | O A M |
| C | `POST /organizations/{id}/tasks` | `{organizationId, title, start, duration, categoryId (mine), assigneeIds[≥1]}` → 201 (ids de-duplicated) | 400, 403 | O A |
| E | `POST /organizations/{id}/tasks/personal` | `{organizationId, title, start, duration, categoryId}` → 201 (assigned to me) | 400 | O A M |
| E | `PUT /organizations/{id}/tasks/{taskId}` | `{organizationId, taskId, title, start, duration, categoryId}` → 204; the category is checked only when it changes (Q2) | 400, 403, 404 | per `capabilities.canEdit` |
| E | `PUT /organizations/{id}/tasks/{taskId}/assignees` | `{organizationId, taskId, newAssigneeIds[≥1]}` → 204 | 400, 403, 404 | O A |
| E | `DELETE /organizations/{id}/tasks/{taskId}` | → 204 (idempotent) | 403 | per `canDelete` |

The org schedule asks for the **viewer's** week (`weekRange` from `datetime.ts` — planners render in the viewer's zone, D5).
That is not an org range. No overlap check on any org endpoint (Q3).

### 2.6 Board
| Δ | Route | Body / query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `GET /organizations/{id}/issue-board?includeScheduled=false` | → 200 `IssueBoardDto`; `includeScheduled=true` also returns converted issues (`convertedToTaskId` set) | 404 | O A M |
| C | `POST /organizations/{id}/issue-panels` | `{organizationId, name 1–100}` → 201 `IssuePanelDto` | 400, 403, **409 duplicate name** | O A |
| C | `PUT /organizations/{id}/issue-panels/{panelId}` | `{organizationId, panelId, name 1–100}` → 204 (**add validator**) | 400, 403, 404, 409 | O A |
| E | `DELETE /organizations/{id}/issue-panels/{panelId}` | → 204, cascades its issues | 403 | O A |
| C | `POST …/issue-panels/{panelId}/issues` | `{organizationId, panelId, title ≤200, notes?, categoryId (mine)}` → 201 `IssueDto` | 400, 403, 404 | O A |
| C | `PUT …/issue-panels/{panelId}/issues/{issueId}` | same + `issueId` → 204; **category checked only when it changes** | 400, 403, 404, 409 moved/converted | O A |
| C | `DELETE …/issue-panels/{panelId}/issues/{issueId}` | → 204; **scoped to the org (IDOR fix)** | 403, 409 converted | O A |
| C | `PUT /organizations/{id}/issues/{issueId}/move` | `{organizationId, issueId, newPanelId}` → 204 | 403, 404, **409 converted** | O A |
| C | `POST /organizations/{id}/issues/{issueId}/promote-to-task` | `{organizationId, issueId, start, duration, assigneeIds[≥1]}` → 201 `TaskItemDto` | 400, 403, 404, 409 already converted | O A |
| E | `GET …/issue-panels[/{panelId}[/issues[/{issueId}]]]` | unchanged; the frontend uses the board only | | O A M |

### 2.7 Analytics (selection contract, org zone)
| Δ | Route | Query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `GET /organizations/{id}/analytics?view&year&from&to` | → 200 `OrgAnalyticsDto` | 400 invalid selection / >400 days, 403 | O A |
| C | `GET /organizations/{id}/analytics/members/{memberId}?view&year&from&to` | → 200 `MemberAnalyticsDto` | 400, 403 (M asking for another member), 404 never a member | O A any; M self |
| N | `GET /organizations/{id}/analytics/years` | → 200 `number[]`: calendar years in the **org zone** with org tasks (M: assigned to me), newest first; the current org-zone year when empty | 404 | O A M |

- Parse with `ReportSelection.TryCreate` and resolve with `ReportModelBuilder.ResolveRange(selection, orgZone)` (the same rules
  as reports). Bucket with `TaskAnalyticsBreakdown.Build/EnumerateBuckets` in `TimeZoneResolver.ResolveOrUtc(org.TimeZoneId)`.
  **`X-Time-Zone` is ignored.** The old `startDate/endDate` parameters are removed (no client uses them; update the tests).
- A task counts in a bucket by its start instant (same as personal analytics). Categories are the creator's personal ones (Q2 "now").

### 2.8 Activity
| Δ | Route | Query → 2xx | Errors | Who |
|---|---|---|---|---|
| C | `GET /organizations/{id}/activity?before=<Instant>&limit=50` | `limit` 1–100 (validator, else 400); `before` exclusive, default now → 200 `ActivityPageDto` | 400, 404 | O A M |

Still derived; **no migration**. Each source runs `Where(ts < before).OrderByDescending(ts).Take(limit + 1)`. Merge the results,
order by (timestamp desc, id), take `limit`; `nextBefore` = the last item's timestamp when more exist.
| Source | Item | Actor |
|---|---|---|
| Organization | `Created` (`CreatedOnUtc`) | `CreatedByUserId` |
| Tasks of the org | `Created` (`CreatedOnUtc`); `Updated` (`UpdatedOnUtc`, latest only) | `CreatedByUserId` / **`UpdatedByUserId`** (fix) |
| Memberships | `Joined` (`CreatedOnUtc`, first join); `Left`/`Removed` (`UpdatedOnUtc` when that is the status) | self / `UpdatedByUserId` |
| Issues (incl. converted) | `Created` (`CreatedOnUtc`) | `CreatedByUserId` |
| `ReportExports` with this `OrganizationId` (written by Phase 4) | `Exported` (`CreatedOnUtc`), `entityId` = documentId | `RequestedByUserId` |

Members see **task items only for tasks assigned to them** and report items only where they are the requester or subject
(§8 Q-A). Known limits, documented in the DTO comment: deleted tasks vanish; only a task's latest update shows; a re-join keeps
the first "Joined".

---

## 3. SignalR contract (3F backend, 3G client)

- **URL**: `{API origin}/hubs/organization` (`VITE_API_BASE_URL` without `/api`). CORS already allows credentials.
- **Auth**: `JwtBearerEvents.OnMessageReceived` takes `context.Request.Query["access_token"]` when the path starts with `/hubs`.
  Negotiate uses the `Authorization` header (`accessTokenFactory`). Request logging logs the path only, so the token stays out of
  logs. Don't log query strings.
- **Connect**: `OnConnectedAsync` loads the user's **Active memberships from the DB**. It adds the connection to `org:{id}` for
  each, and to `org:{id}:admins` when the role is O/A. It also records `userId → connectionIds` in a singleton
  `HubConnectionRegistry` (`OnDisconnectedAsync` removes them). The hub stops reading the `organization_membership` claims; drop
  those claims from `TokenService` (nothing else reads them).
- **Hub method**: `Subscribe(organizationId: string) → { organizationId, role }`. It re-checks Active membership in the DB and
  (re)adds the connection to the right groups. Otherwise it throws `HubException("Organization not found.")`. The client calls it
  when it enters an org route and after joining, accepting or creating.
- **Server-side group upkeep** (notifier + registry, after the commit, after sending the event): join/accept → add all of the
  user's connections. Role change / transfer → add to or remove from `:admins`. Leave/remove → send the event, then remove from
  both groups. Org delete → send, then remove everyone.
- **Audiences**: board, member and org events → `org:{id}`. **Task events → `org:{id}:admins` + `Clients.Users(…)` for the
  non-admin Active members among the current ∪ previous assignees** (helper `OrgTaskAudience`; the creator isn't included,
  which matches `GET …/tasks` for members). Personal-channel events → `Clients.User(userId)`. The default `IUserIdProvider`
  works (`sub` maps to NameIdentifier).
- **Payloads**: camelCase (SignalR JSON default), instants with Z (`UtcDateTimeJsonConverter` is registered, `Program.cs:204-206`).
  Every payload carries `organizationId` except `MyInvitationsChanged`.

| Event | Payload | Audience | Δ |
|---|---|---|---|
| `TaskCreated` / `TaskUpdated` | `TaskItemDto` (`capabilities: null`). `TaskUpdated` also reaches removed assignees so they can drop the task | admins + participants | C (audience) |
| `TaskDeleted` | `{organizationId, taskId}` (also once per task hard-deleted by `RemoveMember`) | admins + participants | C |
| `IssueCreated` / `IssueUpdated` | `IssueDto`. **Promote sends `IssueUpdated` with `convertedToTaskId`** (was `IssueDeleted`) | org | C |
| `IssueDeleted` | `{organizationId, panelId, issueId}` | org | E |
| `IssueMoved` | `{organizationId, issueId, oldPanelId, newPanelId}` | org | C (+oldPanelId) |
| `PanelCreated` / `PanelUpdated` | `IssuePanelDto` | org | E |
| `PanelDeleted` | `{organizationId, panelId}` | org | E |
| `OrganizationUpdated` | `OrganizationDto` (`myRole`, codes, expiries all null) | org | C |
| `OrganizationDeleted` | `{organizationId}` | org | N |
| `MemberJoined` | `MembershipDto` (also on a re-join by code) | org | C |
| `MemberLeft` | `{organizationId, leftUserId}` | org | E |
| `MemberRemoved` | `{organizationId, removedUserId, tasksDeleted: boolean}` | org | C |
| `MemberRoleUpdated` | `{organizationId, memberUserId, newRole}` | org | E |
| `MemberSettingsUpdated` | `MembershipDto` | org | E |
| `OwnershipTransferred` | `{organizationId, newOwnerId, oldOwnerId}` | org | E |
| `InvitationsChanged` | `{organizationId}` (invite, rescind, accept, decline). The client refetches the list | admins | N |
| `MyInvitationsChanged` | `{}`. Goes to the invitee's user id when an account with that email exists. The client refetches the inbox | user | N |

Client (3G): pin `@microsoft/signalr` to the latest 9.0.x, exact version (`npm i -E`), and load it lazily (`import()`) only once
the signed-in user has ≥ 1 org. Use `withAutomaticReconnect([0, 2000, 5000, 10000, 30000])`. `accessTokenFactory` returns the
access token, after `refreshSessionInBackground()` when it expires within 30 s. Stop on session change (`onSessionChange`). The
connection is tied to the session epoch: events that arrive after logout are dropped. On `onreconnected`, `Subscribe` the current
org and refetch the visible org data and the personal week. Show a "Live updates paused" pill after 10 s disconnected. Hub
upserts are idempotent by id, which absorbs our own echoes.

---

## 4. Migrations and deploy notes
- **No migration in Phase 3** (activity stays derived; no ordering columns; invitation statuses already fit `nvarchar(450)`).
  If the owner picks the event table in §8 Q-B, 3A adds `AddOrganizationActivity` (run `dotnet ef` with
  `Serilog__WriteTo__1__Args__path` redirected, on LocalDB only).
- Azure already runs every migration up to `AddRefreshTokenGracePeriod` (owner ran `deploy/migrate-database*.sql`, 2026-10-24).
- Azure App Service: turn on **Web sockets** (Configuration → General settings), or the client falls back to SSE/long polling,
  which still works. **The Free (F1) plan allows only 5 concurrent WebSockets; D1 allows 35.** The in-memory
  `HubConnectionRegistry` assumes **one instance**: scaling out needs Azure SignalR Service or a backplane. Keep query strings out
  of App Service HTTP logs (`access_token`).
- Emails sent before 3A link to `/accept-invite?token=…`. The frontend keeps a redirect route for them.
- Breaking API changes (no deployed client uses them): org analytics parameters, the activity response shape, `"hidden"` → `null`.

---

## 5. Sub-phases

```
3A REST backend ──► 3F hub backend ─────────────────────────────┐
3B frontend foundations (parallel with 3A; live checks after 3A) ┤
   ├─► 3C org schedule ─┐                                         │
   ├─► 3D board ────────┼──► 3G real-time client (needs 3C+3D+3E+3F)
   └─► 3E members · analytics · activity · org settings ┘
```
This adjusts the suggested split: the board leaves 3C (the `WeekView` refactor alone is L), and real-time is split into a backend
part (3F, which can run while the frontend is built) and a client part (3G).

| | Size | Branch (stacked PRs into `development`, "Create a merge commit") | Runs in parallel with |
|---|---|---|---|
| 3A | backend L | `feature/org-api` ← `feature/organizations` (carries this plan) | 3B |
| 3F | backend M | `feature/org-realtime-api` ← 3A ("stacked on #3A") | 3B–3E |
| 3B | frontend M–L | `feature/org-shell` ← `feature/organizations`; merge 3A in for live checks → PR stacked on 3A | 3A, 3F |
| 3C | frontend L | `feature/org-schedule` ← 3B | 3D, 3E, 3F |
| 3D | frontend M | `feature/org-board` ← 3B | 3C, 3E, 3F |
| 3E | frontend M–L | `feature/org-pages` ← 3B | 3C, 3D, 3F |
| 3G | frontend M | `feature/org-realtime` ← 3C with 3D, 3E, 3F merged in | — |

**Conflict rules.** 3B creates every route, every placeholder view (one file per page, each owned by exactly one later
sub-phase), the full `types/org.ts`, `services/orgService.ts` (every endpoint in §2), `useOrgPermissions`, the nav, the datetime
helpers, the shortcut rows and `components/org/MemberMultiSelect.vue`. 3C/3D/3E only *fill* their own views and components.
Edits to 3B files must be additive. Ownership:
3C — `WeekView.vue`, `TaskEditor.vue`, `useTaskEditor.ts`, `components/planner/*`, `clipboardStore.ts`, `taskClipboard.ts`,
`orgScheduleStore.ts`, the personal-copy sync in `taskStore.ts`.
3D — `components/board/*`, `issueBoardStore.ts`, `lib/board.ts`.
3E — `components/org/{members,analytics,activity,settings}/*`, `orgMembersStore.ts`, `useAnalyticsSelection.ts`, the
`TaskAnalytics.vue` refactor.
3G — `services/orgHub.ts`, `lib/orgEvents.ts`, and wiring into the stores above.

### 5.0 Manual verification recipe (every sub-phase)
- API (PowerShell): `$env:ConnectionStrings__DefaultConnection="Server=(localdb)\MSSQLLocalDB;Database=TimePlannerDb_<phase>_<rand>;Trusted_Connection=True;TrustServerCertificate=True"`,
  `$env:Serilog__WriteTo__1__Args__path="<scratchpad>\apilogs\log-.txt"`, `$env:JwtSettings__Secret="<test value, 64 chars>"`,
  `$env:PostmarkSettings__ServerToken=""` (the real secrets file is loaded otherwise), `$env:FrontendBaseUrl="http://localhost:<vite>"`.
  Then `dotnet ef database update` (same env), then `dotnet run --urls http://localhost:<api>`.
- Vite: `$env:VITE_API_BASE_URL="http://localhost:<api>/api"; npx vite --port <unique> --strictPort` (never the production
  `.env` URL).
- Two users at once: storage is per origin, so drive user A in your own browser-pane tab and users B/C through a small Node script
  against the API (as the earlier reviews did). Read invitation tokens from the LocalDB `OrganizationInvitations` table (no email is
  sent).
- Clean up: stop the servers, drop the DB, close your tab, reset the viewport, and check `TimePlanner.API/Logs` still holds the
  owner's files.
- Done = `npx vue-tsc -b` 0 · `npm test` · `npm run build` · `find src -name "*.js"` empty · `dotnet build` (no new warnings) ·
  `dotnet test`.

### 3A — REST backend support (all of §2)
- **Files**: `Controllers/{Organizations,Invitations}Controller.cs`. DTOs in `DTOs/Organizations/*` (+ `InvitationPreviewDto`,
  `ActivityPageDto`). New queries/commands: `GetOrganizationTask`, `GetOrganizationInvitations`, `RescindInvitation`,
  `GetInvitationPreview`, `GetInvitationById`, `DeclineInvitation` (token/id), id-based accept (share the handler with the token
  path), `GetOrganizationYears`. Changed: `GetOrganizationById`, `GetMyOrganizations`, `CreateOrganization`, `RegenerateJoinCodes`
  (one `OrganizationDtoMapper.For(org, myRole)`), `GetOrganizationMembers`, `GetMyMembership`, `GetJoinCodes`, `UpdateMemberRole`,
  `AcceptInvitation`, `InviteUser`, `GetMyInvitations`, `GetOrganizationAnalytics`, `GetMemberAnalytics`, `GetOrganizationActivity`,
  board handlers, `CreateOrganizationTask`/`PromoteIssueToTask` (distinct ids). Tests: `OrganizationPermissionTests` +
  new integration test files.
- **Accept when**: every §2 row behaves as written (status codes and shapes). CS1998 is gone. The permission matrix (§6) passes.
  Org delete with panels + issues + tasks + invitations + exports returns 204 on LocalDB. Optional: fold in backlog item 7
  (template ownership on personal task create/update) if time allows — separate commit.
- **Manual**: create org A (owner), join an admin and a member by code. As the member: codes are `null`, the members list shows
  Active only, another member's analytics → 403. Analytics for an org in America/New_York with a task at `2026-11-01T04:30Z`
  lands in the Nov 1 bucket while the client sends `X-Time-Zone: Asia/Tokyo`. Invite → re-invite (409) → token preview signed
  out (masked email) → decline → accept → 409.

### 3B — Frontend foundations
- **Types/services**: `src/types/org.ts` (all §2.1 shapes). `src/services/orgService.ts` has one typed function per §2 endpoint,
  normalizes instants with `normalizeApiInstant` and tasks with `normalizeTask`, and applies `reportSelection()` to analytics
  queries. `apiDataService.updateMyProfile`.
- **Stores**: `stores/orgStore.ts` — `orgs`, `invitations`, `loadMine()` (orgs + inbox, one shared in-flight request per session
  epoch, fired after sign-in), `ensureMembership(orgId) → 'active'|'missing'|'error'` (cached list first, then `GET …/members/me`),
  `refreshMembership(orgId)` (subscribed to `onForbidden`), `create`, `joinWithCode`, `accept/decline` (by id or token), `leave`,
  `removeLocal`, `upsertLocal`, `setRole`, `selectableMembers(orgId)` (cached). Every action is wrapped in `sessionBound` and
  cleared by `onSessionChange`.
- **Permissions**: `src/lib/orgPermissions.ts` with a pure
  `can(role, action, ctx?) → { allowed: true } | { allowed: false; hidden: boolean; reason: string }`. `hidden` = the role can
  never do it; otherwise "disable with a reason". It also has `taskCapabilitiesFor(role, task, meId)` (= server
  `TaskCapabilities.For`, used for hub payloads). `composables/useOrgPermissions.ts` binds role and meId from `orgStore` /
  `useCurrentUserId`.
- **Routes** (org views lazy-loaded; `:orgId` restricted to the GUID pattern; all `requiresAuth` except the landing page):
  `/settings` (Settings) · `/orgs` (Orgs) · `/orgs/:orgId` → `OrgLayout` redirecting to `schedule`, children `schedule` (OrgSchedule, 3C),
  `board` (OrgBoard, 3D), `members`, `analytics`, `activity`, `settings` (3E) · `/invitations/:token` (InvitationLanding,
  auth layout) · `/accept-invite` → `/invitations/:token`.
  The guard stays synchronous. A guest goes to `/login?redirect=<path>&reason=orgs`; `LoginView` shows "Organizations need a free
  account" and returns via `safeRedirect()` (allows only `/` paths, never `//` or `/\`).
  **The membership check lives in `OrgLayout`, not the router**, so a cold server doesn't freeze navigation.
  `decideOrgAccess(result)`: `active` → render `<RouterView :key="orgId">`; `missing` → toast "You're not a member of that
  organization" + `replace('/orgs')`; `error` → `UiErrorState` + Retry. While it waits: a skeleton plus the existing slow-server
  hint. `OrgLayout` sets the title to `"{page} · {org} · Time Planner"`.
  No org page is admin-only (each renders role-specific content), so there is no `meta.orgRoles`.
- **Shell**: `navItemsFor(context)`. Personal: Planner, Today, Analytics, Templates. Org (every role): Schedule, Board,
  Analytics, Members, Activity, Settings. Hotkeys 1–4 = the first four of the current context (looked up when pressed, not at
  setup).
  `components/shell/ContextSwitcher.vue`: Personal / each org (monogram in `org.color`, name, role badge) / "Invitations (n)" /
  "Create or join…" → `/orgs`. It sits at the top of the expanded sidebar and the tablet drawer; on the rail it is a monogram
  button with the same menu; on phones it is a "Workspace" section of `AppMoreSheet`. The tab bar shows the first four items +
  More (the rest go in the More sheet). `O` opens the switcher (the More sheet on phones). The sidebar footer and More sheet link
  `/settings`. Sidebar calendar and FAB also show on OrgSchedule. Add an "Organizations" group to `ShortcutsDialog` (O; 1–4
  follow the workspace; board M / P / Enter).
- **Pages**: `/orgs` — inbox (accept/decline by id), org cards, Create dialog (name; the zone defaults from the device on the server
  side, "change it later in settings"), Join-with-code (8 chars, uppercased, spaces/dashes stripped); `UiEmptyState` when empty.
  `/invitations/:token` — preview; signed out: Log in / Create account (keeps `redirect`), plus `tp-pending-invitation` =
  `{token, savedAt}` in localStorage (try/catch, 7 days) so the flow survives email confirmation, then `/invitations/:token` after
  login; signed in: Accept/Decline; wrong account: "Sent to m•••@gmail.com, you're signed in as …" + Log out. `/settings` —
  display name (1–100, empty = "we'll show your email"), email (read-only), theme, device time zone (read-only label), Sign out.
  Placeholder org pages use `UiEmptyState` "Coming soon".
- **Datetime helpers** (in `datetime.ts` only; added here so later phases don't edit it): `formatZoneLabel(zone, at)` →
  `"America/New_York (UTC−04:00)"`, `formatTimeInZone(at, zone)`, `zoneDiffersFromActive(zone, range)` (compares offsets, so alias
  names like `Asia/Calcutta` count as equal), `supportedTimeZones()` (`Intl.supportedValuesOf` with a fallback).
  `components/org/MemberMultiSelect.vue` (assignee picker for 3C/3D).
- **Accept when**: a guest deep link to `/orgs/x/board` lands back there after login. The switcher works at 375 px, in the rail
  and in the tablet drawer. A removed member opening an org URL gets the toast + `/orgs`. Hotkeys follow the context.
  Existing tests stay green.

### 3C — Org schedule
- **`PlannerSource`** (`components/planner/plannerSource.ts`, provide/inject; the default is personal, so `PlannerView` doesn't
  change):
  ```ts
  interface PlannerSource {
    kind: "personal" | "org"; orgId: string | null;
    tasks(): readonly Task[]; isLoading(): boolean; getTaskById(id: string): Task | undefined;
    categoryOf(task: Task): { name: string; color: string };   // org: the task's own categoryName/Color
    canEdit(task: Task): boolean; canDelete(task: Task): boolean;
    conflictOf(task: Task): Task | undefined;                   // blocking: personal = findConflict; org = never (Q3)
    warningsOf(task: Task): Task[];                              // org: loaded tasks sharing an assignee; personal: []
    move(task: Task, original: Task, opts: MoveOptions): Promise<boolean>;
    remove(id: string): Promise<boolean>;
    openCreate(opts: OpenCreateOptions): void; openEdit(task: Task, anchor?: DOMRect | null): void;
    copy(task: Task, opts?: { arm?: boolean }): void;
    paste(start: UtcIsoString): Promise<Task | null>; duplicate(task: Task, days: 1 | 7): Promise<Task | null>;
  }
  ```
  `WeekView` uses only the injected source (it no longer imports `taskStore`). Week navigation stays week-number based and shares
  `uiStore.currentDate`.
- **Editor**: `openCreate({ …, target })` with
  `EditorTarget = { kind: "personal" } | { kind: "org"; orgId; defaultAssigneeIds }`. In org mode the editor shows
  `MemberMultiSelect` (only if `can('task.createForOthers')`; members are assigned to themselves via `/tasks/personal`) and
  non-blocking warnings ("Overlaps “Standup” for Kari"). It also shows an "03:00 Acme time" hint when
  `zoneDiffersFromActive`. Edits save `PUT task`, then `PUT assignees` when they changed and `canReassign`. The current
  (possibly another admin's) category stays selectable. "New task" in an org context opens the org target.
- **Store**: `stores/orgScheduleStore.ts` — `load(orgId, range, memberId)` with the `taskStore` race guards (request seq,
  mutation counter, session epoch, orgId check), `create/update/setAssignees/remove` (optimistic + Undo through
  `orgService.createTask` with the original assignees), refetch on 403/409. After each successful mutation,
  `syncPersonalCopy(taskStore, task, meId)` upserts the task into My planner if I'm an assignee and it falls in the loaded week,
  and removes it otherwise.
- **View**: `OrgScheduleView` = header + member filter (O/A: "Everyone" + selectable members; hidden when only one member, so
  single-member orgs look clean — backlog 5) + zone note ("Times are in your time zone (Europe/Oslo). Acme uses America/New_York.")
  + `WeekView` with the org source + assignee initials on blocks.
- **Copy/paste (§8 Q-C)**: `CopiedTask` gains `sourceOrgId`/`assigneeIds`. Pasting into org X's schedule creates an org task in X.
  A/O: the copied assignees if the copy came from X, else the filtered member, else me. M: themself. Category rules as today; no
  template (org endpoints don't take one). Overlaps only warn. The personal planner is unchanged (always personal).
- **Accept when**: the personal planner behaves exactly as before (existing planner specs untouched and green). An admin can
  create, drag, resize and reassign in the org schedule. A member can't drag admin-assigned tasks (Q1). A change in the org
  schedule shows in My planner without a reload.
- **Manual**: as admin, assign a task to yourself and the member, drag it across a week boundary, check My planner; create an
  overlapping task (warning, saved); switch the member filter; set the org zone to a different one and check the note and the hint.

### 3D — Board
- `stores/issueBoardStore.ts` + pure `lib/board.ts`: `moveIssue(board, id, toPanel) → { board, undo }`, `upsertIssue`,
  `removeIssue`, ordering by `createdOnUtc`. Move is optimistic. Rollback + toast on network/5xx; 404 → remove + toast; 409 →
  refetch.
- `OrgBoardView` + `components/board/{BoardColumn,IssueCard,IssueDialog,PromoteIssueDialog,PanelMenu}.vue`. Desktop: columns with
  horizontal scroll, pointer drag between columns. Phones: one panel + a `UiSelect` picker; move through the card menu. Keyboard on
  a focused card: `M` opens "Move to…" (`UiMenu`), `P` promotes, Enter opens, Delete deletes (Undo re-creates). Panel
  rename/delete (confirm: "Delete “Backlog” and its 4 issues?"). A "Show scheduled" toggle (`includeScheduled`) shows converted
  cards with a "Scheduled" badge, read-only.
- Promote dialog: date + start in the viewer zone, `DurationChips`, `MemberMultiSelect`. On success the card leaves (or gets the
  badge) and a toast "Scheduled “X” for Mon 09:00" offers "Open schedule".
- Members: read-only board (no drag, create or menus beyond Open).
- **Manual**: drag a card while the API is stopped → it rolls back. Promote, then promote again from a stale tab → 409 message.
  Keyboard-only move and promote. 375 px layout.

### 3E — Members, org analytics, activity, org settings
- **Members**: `stores/orgMembersStore.ts` (members, pending invites, codes). List rows on desktop, cards on phones: name, email,
  role badge, status, status message; filter Active | Former (O/A). Row menu from `can()`: make admin/member, transfer ownership
  (Owner, to Admins), remove (dialog: "Also delete their tasks in Acme" → `hardDeleteTasks`, explaining that shared tasks just
  drop them). Invite card (email + role, inline 409 text) + pending list (rescind). Join-codes card (O/A: copy, relative expiry via
  `formatRelativeToNow`; Owner: Regenerate 1 / 7 / 30 days).
- **Analytics**: extract `composables/useAnalyticsSelection.ts` from `TaskAnalytics.vue:38-106`, with available years injected.
  `TaskAnalytics.vue` uses it with no behaviour change. `composables/useOrgAnalytics.ts` fetches with the selection (race guard:
  seq + orgId + epoch; keeps the previous data while refetching). Pure `lib/orgAnalytics.ts` `orgSnapshot(dto, sel)` →
  `AnalyticsSnapshot`: periods from `analyticsBuckets(sel)` keys + server values, so the client never builds ranges.
  O/A: KPI tiles (total hours, assigned hours, tasks, members with time), time per member (horizontal bars + `ChartDataTable`;
  click → member drill-down `?member=<id>`), category donut, hours by period. M: their own member analytics. The subtitle uses the
  server's `timeZoneLabel` ("In Acme's time zone · …"). Keep an empty actions slot in the header for Phase 4 Export.
- **Activity**: `composables/useOrgActivity.ts` (pages via `before`, dedupe by `id`) grouped by day in the viewer zone (Today /
  Yesterday / date). Relative time with an absolute tooltip, "Load more" (`aria-busy`), an end-of-feed note.
- **Org settings**: Organization (name and zone editable for O/A, read-only for M; the zone picker searches `supportedTimeZones()`
  with `formatZoneLabel`). My membership (status message ≤150; Leave, disabled for the owner with "Transfer ownership first").
  Danger zone for the owner (transfer to an admin; delete after typing the name). After leave/delete: `orgStore.removeLocal`,
  `/orgs`, toast, focus restored.
- **Manual**: as admin, invite, rescind, change roles, remove with tasks. As member, check the menus are absent. Analytics for
  2026-W53 and a DST week in an org zone ≠ device zone match the numbers from the API. Activity paging over > 50 items.

### 3G — Real-time client
- `services/orgHub.ts` (lazy, §3 client rules) and pure `lib/orgEvents.ts`: event union + `applyOrgEvent(slice, event, ctx)`
  reducers for the org list/role, schedule, personal planner, board and members.
  `composables/useOrgLive.ts` wires them up and drives the "Live updates paused" pill in `OrgLayout`.
- Self events: `MemberRemoved`/`MemberLeft`(me) or `OrganizationDeleted` → drop the org, toast, `/orgs` if on it.
  `MemberRoleUpdated`(me) → update the role (nav and permissions react). `TaskUpdated` no longer listing me → remove it from My
  planner. `TaskCreated` for me in the loaded week → add it. `InvitationsChanged` / `MyInvitationsChanged` → refetch.
- **Manual**: two users (browser + script). A script-side assign/move/delete shows within about 1 s. Removing the browser user
  ejects them. Stopping the API shows the pill after 10 s; restarting refetches. Logging out stops the connection.

---

## 6. Permission matrix (API and `can()` must both follow it)

✓ allowed · ✗ hidden (the role can never do it) · ◐ circumstantial (disable with a reason) · non-members always get 404.

| Action | Owner | Admin | Member | Notes / API today |
|---|---|---|---|---|
| View org, board, activity, members directory | ✓ | ✓ | ✓ (Active members only) | **API: directory is O/A only → 3A** |
| Edit name/zone | ✓ | ✓ | ✗ | |
| Delete org, transfer ownership, regenerate codes | ✓ | ✗ | ✗ | transfer target = active Admin (◐ "Make someone an admin first") |
| View/copy join codes | ✓ | ✓ | ✗ | **API: Owner only → 3A (Q8)** |
| Invite, list/rescind invites | ✓ | ✓ | ✗ | |
| Change role | ✓ | ✓ promote only; ◐ demote an admin "Only the owner…" | ✗ | owner target ✗ |
| Remove member | ✓ | ✓ (target Admin: see §8 Q-E) | ✗ | owner target ✗ |
| Leave | ◐ "Transfer ownership first" | ✓ | ✓ | |
| Own status message | ✓ | ✓ | ✓ | |
| See every member's schedule, member filter | ✓ | ✓ | ✗ (own tasks only, Q6) | **hub sends all tasks to all → 3F** |
| Create org task for others | ✓ | ✓ | ✗ | |
| Create own org task (`/tasks/personal`) | ✓ | ✓ | ✓ | |
| Edit / delete org task | ✓ | ✓ | ✓ if creator, else ✗ (Q1) | = `TaskCapabilities.For` |
| Reassign | ✓ | ✓ | ✗ | |
| Panels: create/rename/delete · Issues: create/edit/delete/move/promote | ✓ | ✓ | ✗ | |
| Org analytics; any member's analytics | ✓ | ✓ | ✗ | |
| Own member analytics, years | ✓ | ✓ | ✓ | |
| Task items in activity | all | all | assigned to me (§8 Q-A) | **API: all → 3A** |

Other places where the API disagrees and 3A/3F fix it: `members/me` 200 for former members; accept overwriting roles;
`UpdateMemberRole` on non-active targets; `UpdateIssue` category check; cross-org `DeleteIssue`; moving converted issues.

---

## 7. Tests worth writing (owner's rule: each must fail on a breakage that matters)

- **3A** (LocalDB integration): extend `OrganizationPermissionTests` — directory → Member level, join codes → AdminOrOwner, new
  rows (invitations list/rescind, task by id, years, selection analytics). Shapes: `myRole`; codes `null` for M and set for A; Z
  instants. Org-zone bucketing: org America/New_York vs header Asia/Tokyo; the 2026-11-01 DST-end day; weekly W44/W45; 2026-W53;
  zero-fill count = bucket count; `totalHours` vs `assignedHours` with a two-assignee task. Invitations: duplicate pending 409,
  expired-then-re-invite 201, accept by id and by token, wrong user 404, rescinded → accept 409, **already-active accept keeps the
  role** (regression), anonymous preview masks the email. **Cross-org `DeleteIssue` → 404 and the issue survives.** A member's
  task-by-id for another member's task → 404. Activity: `limit` 101 → 400; `before` paging with no gaps or duplicates; the update
  actor is the updater; a member doesn't see other people's task titles. Org delete with board + tasks + invites → 204.
- **3F**: a SignalR client test (`Microsoft.AspNetCore.SignalR.Client` 9.0.x in tests; a fixture variant with the real notifier;
  `WithUrl(".../hubs/organization?access_token=…", o => { o.HttpMessageHandlerFactory = _ => server.CreateHandler(); o.Transports = LongPolling; })`).
  Cases: no token → 401. A user who joined after their token was issued gets events. A removed member stops getting events. A
  member does not get `TaskCreated` for someone else's task, gets it for their own, and the admin gets both. `Subscribe` to a
  foreign org → HubException.
- **3B**: the `can()` matrix as a table test (every §6 row × role) + `taskCapabilitiesFor` parity with the server table.
  `safeRedirect` (open-redirect cases). `decideOrgAccess` (missing → `/orgs`, error → error state). `orgStore` drops answers from a
  previous session epoch. `formatZoneLabel`/`zoneDiffersFromActive` (DST, +05:45, alias names; runs in all 13 zone projects).
- **3C**: the org source never blocks on overlap but warns only for shared assignees. `orgScheduleStore` race guards (week switch
  and member-filter switch mid-load, mutation during load). `syncPersonalCopy` (assigned / unassigned / outside the week, no
  duplicates). Paste target rules for the org (assignees kept only within the same org; a member → self). The existing planner
  specs are the regression net for the refactor — don't duplicate them.
- **3D**: the move rollback paths (network, 404, 409) on the store. Promote on an already converted issue (409) leaves the board
  consistent. Keyboard move uses the same store path (test the store, not the DOM).
- **3E**: `orgSnapshot` (W53, keys mapping in order, missing key → 0, totals). Activity merge/dedupe across pages + day grouping
  at a DST boundary. `useAnalyticsSelection` extraction: the existing analytics specs stay green (no new tests).
- **3G**: the `applyOrgEvent` reducers — idempotent echo, `TaskUpdated` dropping me from My planner, out-of-week ignored,
  `MemberRemoved`(me) navigation decision, role change. Events after a session change are ignored. Reconnect triggers a refetch.
- Not worth it: snapshots, CSS classes, menu markup, re-testing axios/Pinia/SignalR.

---

## 8. Open questions (new; recommendation in bold)

| # | Question | Recommendation |
|---|---|---|
| Q-A | Q6 (members see only their own tasks) conflicts with Q7 (every member reads the whole activity feed, including task titles). | **Members see task activity only for tasks assigned to them**; member, board and org events stay visible to all. |
| Q-B | Activity source: keep it derived from existing tables (no migration, but no who-removed-whom history beyond `UpdatedBy`, no deletes, latest update only), or add an append-only `OrganizationActivities` table written by every handler? | **Derived in Phase 3**; put the event table in the backlog (it fits with Phase 4 exports). |
| Q-C | Copy/paste in the org schedule (backlog item 3). | **Paste into an org schedule creates an org task in that org** (assignees as in 3C; a member → self); the personal planner always pastes personal copies. |
| Q-D | Board: converted issues disappear today, while the plan mentions a "Scheduled" badge; there is no ordering column. | **A "Show scheduled" toggle (off by default) using `includeScheduled`; no within-panel or panel reordering in Phase 3** (oldest first; no migration). |
| Q-E | An Admin can remove another Admin today, but can't demote one (only the Owner can). | **Only the Owner may remove an Admin** (403 for admins), consistent with demotion. Business-rule change → needs a yes. |
| Q-F | Invitation preview and decline by token without signing in. | **Yes, both anonymous.** The 256-bit token is the secret; the preview shows a masked email. Accept still needs the matching account. |
