# Time Planner — guide for AI agents

Personal + organizational time planner. **Frontend:** Vue 3 + TypeScript + Vite + Pinia + Chart.js (`Frontend/time-planner-app`).
**Backend:** .NET 9 ASP.NET Core, EF Core (SQL Server), MediatR CQRS + FluentValidation pipeline, Identity + JWT, SignalR (`TimePlanner.API`).
**Tests:** `TimePlanner.API.Tests` (xUnit, unit + LocalDB integration) and vitest (13 timezone projects + an architecture test).
Current roadmap: `docs/plans/pdf-export-and-organizations.md` (phases, decisions, contracts).

## Commands
- Frontend (in `Frontend/time-planner-app`): `npx vue-tsc -b` (must be 0 errors) · `npm test` · `npm run build` · `npm run dev`.
  After any type-check, `find src -name "*.js"` must be empty (compiled .js next to .ts would shadow the sources in Vite).
- Backend (repo root): `dotnet build BackendTaskSchedule.sln` · `dotnet test BackendTaskSchedule.sln`.
- Done = all of the above green. Don't add warnings (one pre-existing CS1998 in `InvitationsController.cs` is known).

## Hard rules
- **Never** connect to the real database (`Server=MAJD` in appsettings.json) or the production API (`Frontend/.env` `VITE_API_BASE_URL`).
  Backend tests/manual runs use throwaway SQL Server **LocalDB** databases (`(localdb)\MSSQLLocalDB`), dropped afterwards.
- **Logs:** anything that boots the API (`dotnet run`, `dotnet ef`, integration tests) must set
  `Serilog__WriteTo__1__Args__path=<temp dir outside the repo>/log-.txt` — the default file sink keeps 7 files and deletes the
  owner's old logs in `TimePlanner.API/Logs`.
- **Secrets** live only in the gitignored `TimePlanner.API/appsettings.Secrets.json` (template: `appsettings.Secrets.example.json`).
  Never print, commit, or copy them elsewhere. Tests set `JwtSettings__*` via environment variables.
- No email may be sent in tests/manual runs (leave the Postmark token empty for local runs).
- Don't change functionality or business rules outside the task's scope; flag them instead.

## Datetime conventions (critical — this app had a UTC/local bug)
- `Frontend/time-planner-app/src/lib/datetime.ts` is the **only** place allowed to import dayjs or use `new Date(`, `Date.parse(`,
  `Date.UTC(`, `.toISOString(`, `toLocale*String` on dates, or `Intl.DateTimeFormat` — enforced by
  `src/lib/__tests__/architecture.spec.ts`. `Date.now()` is fine for non-date timing.
- Instants are UTC ISO strings with `Z` everywhere (memory, localStorage, wire). Calendar dates are `DateKey` "YYYY-MM-DD" in the
  user's zone. Ranges are half-open `[start, end)`. DST: nonexistent times move forward; repeated times take the earlier occurrence.
- The client sends `X-Time-Zone: <IANA id>` on every request; personal analytics/years/reports bucket in that zone; organization
  analytics/reports bucket in the **organization's** zone (`Organizations.TimeZoneId`) — never compute org ranges with `datetime.ts`
  (it only knows the device zone); send the selection (`view/year/from/to`) and let the server resolve it.
- Backend: every `DateTime` is UTC (EF value converter + JSON converter write `yyyy-MM-ddTHH:mm:ss.fffZ`).
- Timezone tests: Git Bash strips `TZ` for native programs — use the vitest per-zone projects, PowerShell `$env:TZ`, or set
  `process.env.TZ` at the top of a script. ICU may report alias zone names (e.g. `Asia/Katmandu`).

## Frontend conventions
- Design system: tokens in `src/styles/tokens.css` (no hard-coded colors), primitives in `src/components/ui/` (barrel `index.ts`),
  icons from `lucide-vue-next`. Light + dark themes, WCAG AA contrast, `prefers-reduced-motion` respected, ≥ 40px touch targets.
- Errors: `src/lib/apiErrors.ts` (403 never triggers token refresh; blob errors via `readBlobError`). Backend errors are `{message, errors}`.
- Planner: drag/touch logic in `composables/useTaskDragAndDrop.ts` + `components/planner/*` (lanes, cross-week drag, day swipe on phones).
  Week navigation is week-number based (the owner prefers it — keep that interaction model).
- No new npm dependencies without the owner's approval.

## Environment gotchas
- **Line endings:** C# files are CRLF. Git Bash `sed -i` silently converts files to LF — prefer the Edit tool, or restore CRLF.
- **Ports:** pick a unique Vite port per agent (`npx vite --port <n> --strictPort`); the browser pane is shared — create your own tab
  and check `location.origin` before running scripts in it. Reset viewport emulation and clear seeded storage when done.
- Guest mode (not signed in, localStorage) needs no backend; signed-in testing needs a local API on LocalDB.
- The hidden browser pane throttles animation frames; synthetic pointer events can't reproduce native touch/scroll arbitration.

## Git workflow
- Branches: `main` (owner merges into it) ← `development` ← `feature/<name>` (one per feature/phase).
- Commit early and often with clear messages; when agents work in parallel, commit **only your own paths**
  (`git add TimePlanner.API TimePlanner.API.Tests` vs `git add Frontend`), retry if `index.lock` exists, never `git add -A` blindly.
- Never force-push, rewrite published history, or commit secrets/build output (see `.gitignore`).
- Open a PR from the feature branch into `development` with a short title and 1–3 line description.

## Handoffs
- Agents keep a checkpoint (task, done, next, how to verify, running servers/DBs) and update it at each milestone so work survives
  interruptions; the orchestrator says where.
