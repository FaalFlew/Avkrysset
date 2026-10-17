# Spec: Task list in analytics, PDF report and task CSV

Status: **APPROVED 2026-10-17** (owner request; field choices delegated to Claude). Builds on Phase 2 (`feature/analytics-export`).
Branch: `feature/analytics-task-list`. Conventions: `CLAUDE.md`.

## Goal
Show every task in the selected analytics range — on the analytics page, in the PDF report, and as a task-level CSV —
with title, duration, start/end, who created it, and other useful fields. Page, PDF and CSV must list exactly the same
tasks in the same order with the same totals.

## Scope and data rules (shared by backend and frontend)
- **Which tasks:** the same scope as personal analytics: `PlannerScope` = personal tasks + org tasks assigned to the user
  in orgs where their membership is Active. Guests: their localStorage tasks.
- **Range:** the selection (`view/year/from/to`) resolved in the user's zone (`X-Time-Zone`), half-open. A task belongs to the
  range (and to a day) by its **start** instant.
- **Category column:** the same grouping as the analytics breakdown — personal tasks: their category; assigned org tasks:
  the **organization name** with the org palette color (`OrganizationPalette`, same as `/api/tasks/analytics`). The page
  takes the org color from the analytics response's category entry (category id = org id), not from its own palette copy.
- **Template:** the template title; none → "—" (PDF/page) / empty (CSV); missing template → "Deleted template".
- **Created by:** the creator's display name (fallback email). Page shows "You" for the signed-in user (and guests).
- **Order:** start ascending, then title (ordinal), then id (ordinal).
- **Day grouping:** by the local date of the start (`toDateKey` in the frontend; zone-converted on the server). End shown as
  local time with a "+1d"/"+2d" marker when it falls on a later local date (use the existing helpers that already produce
  these markers in the planner, e.g. `datetime.ts` / `plannerFormat.ts`).
- **Totals:** per-day subtotal (task count + duration) and a grand total; the grand total MUST equal the "Total time" KPI and the
  task count KPI.

## Columns
| Field | Page (desktop table) | Page (phone card) | PDF | Task CSV |
|---|---|---|---|---|
| Date + weekday | day group header | group header | day group header | `Date` (yyyy-MM-dd), `Weekday` |
| Start – End (+1d) | ✔ | ✔ | ✔ | `Start` (HH:mm), `End` (HH:mm), `End date` (yyyy-MM-dd) |
| Duration | ✔ ("1h 30m") | ✔ | ✔ | `Duration (h)` (2 dp, locale decimal), `Duration` ("1:30") |
| Title | ✔ | ✔ | ✔ | `Title` |
| Category (+ color swatch) | ✔ | ✔ | ✔ | `Category` |
| Template | ✔ | if set | ✔ | `Template` |
| Organization | only if any row has one | if set | only if any row has one | `Organization` |
| Created by | ✔ | ✔ | ✔ | `Created by` |
| Assigned to | — | — | — | `Assigned to` (names joined with ", ") |
| Created at | — | — | — | `Created at` (local "yyyy-MM-dd HH:mm") |

## Backend (TimePlanner.API)
- `ReportModel` gains `Tasks` rows: `StartUtc, EndUtc, DurationHours, Title, CategoryName, CategoryColor, TemplateTitle?,
  OrganizationName?, CreatedByDisplayName, CreatedByUserId, AssigneeNames[], CreatedOnUtc` (built in `ReportModelBuilder`
  with one query; no N+1).
- PDF: a "Tasks" section after the template table: day group header rows ("Monday 5 October 2026 · 3 tasks · 4h 30m"),
  rows (Time, Duration, Title, Category swatch+name, Template, Created by, [Organization]), repeated table header on page
  breaks, grand total row. **Cap 5,000 rows**; beyond that add the note "Showing the first 5,000 of N tasks — use Task list
  (CSV) for the complete list." Fonts/RTL as in the rest of the report.
- Task CSV: `GET /api/reports/personal.tasks.csv?view&year&from&to&locale` + `X-Time-Zone` (same validation, rate limiting,
  `Content-Disposition`, `X-Document-Id`, `Cache-Control: no-store` as the other report endpoints). Filename
  `time-planner-tasks-<selection>.csv` (same selection suffixes as the reports). Same CSV rules as the summary CSV: UTF-8 BOM,
  CRLF, RFC 4180, locale-aware delimiter/decimal (`;` + `,` for comma-decimal locales), formula-injection guard, metadata rows
  `# Time Planner task list export`, `# Range: …`, `# Time zone: …`, `# Generated: …`, `# Document ID: …`. Columns as above.
- Audit: one `ReportExports` row per export (Kind `PersonalTasks`, Format `csv`) — no migration needed.

## Frontend (Frontend/time-planner-app)
- New "Tasks" card at the bottom of the analytics page (`components/analytics/TaskList*.vue`):
  - Signed in: `GET /api/tasks?startDate&endDate` for the selection's instant range (same range the page already uses for
    `/api/tasks/analytics`); guests: localStorage tasks. Map categories per the rules above.
  - Grouped by day with subtotals; grand total; search box (title, case-insensitive); category filter (chips, and clicking a
    category in the donut/category table sets it; clear button); "Show more" paging (100 rows at a time) — print renders all.
  - Row click opens the task in the existing editor (`useTaskEditor`), read-only per `capabilities`.
  - Desktop: table with sticky column header; phones (< 768px): cards. Loading skeleton, empty state ("No tasks in this
    range"), error state with retry. Accessible table semantics (caption, `th scope`), keyboard row activation.
- Export menu: add **"Task list (CSV)"** — signed in → server endpoint; guests → built in the browser
  (`lib/taskListCsv.ts`) with identical columns and formatting rules.
- Print: the task list is included (all rows, light theme, `break-inside: avoid` per row, repeated `thead`).

## Tests
- Backend: model rows/scope/order, day grouping across DST (Europe/Oslo W43/W44) and ISO W53, "+1d" end markers,
  org category mapping, totals = KPIs, 5,000-row cap note, task CSV golden files (en-US, nb-NO) + injection guard, endpoint
  integration (headers, audit row Kind/Format, 400/429), PDF smoke (task titles, group headers, totals; also `--arch x86`).
- Frontend: grouping/subtotals/totals, search + category filter, paging, created-by "You" mapping, org category mapping, guest
  task CSV (format parity with the server), print mode renders all rows.
- Live review: the page list, PDF list and task CSV for the same selection contain the same tasks, order and totals.
