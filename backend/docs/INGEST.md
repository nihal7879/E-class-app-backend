# Data Ingestion — Two Flows

The dashboard needs login/video/MCQ rows in MySQL. Two interchangeable sources can feed those tables:

| Flow | Source | When to use |
|------|--------|-------------|
| **1 — API (primary)** | Senior sir's API | Once his endpoint and auth are ready. Run on a schedule. |
| **2 — Excel (fallback)** | Local `.xlsx` report | Right now, or any time the API is down / incomplete. |

Both flows go through the same pipeline and end up in the same tables. Switching flows changes **one CLI flag** — nothing else.

```
┌─────────────────────────┐
│ Source                  │
│  - excel.ts  (Flow 2)   │  ──►  IngestBatch  ──►  loader.ts  ──►  MySQL
│  - api.ts    (Flow 1)   │
└─────────────────────────┘
        ▲                                          ▲
    swap here                              tables don't change
```

---

## Architecture map

```
backend/src/ingest/
├── types.ts                ← RawUser, RawLogin, RawVideo, RawMcq, IngestBatch
├── transformers.ts         ← parseDate, parseTimeToMs, toInt, toFloat, nullIfEmpty
├── sources/
│   ├── excel.ts            ← Flow 2 — readExcel(filePath) → IngestBatch
│   └── api.ts              ← Flow 1 — readFromApi({url, token}) → IngestBatch  (stub)
├── loader.ts               ← loadBatch(batch, mode) → MySQL upsert/insert in one txn
└── cli.ts                  ← argv parser + flow dispatcher (entrypoint)
```

The two sources produce the **same `IngestBatch` shape**. The loader and the DB schema are completely unaware of where data came from.

---

## Flow 2 — Excel (use this now)

### Prerequisites

1. `.env` is configured with MySQL credentials (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).
2. The schema is already created (run `sql/schema.sql` once).
3. You have an `.xlsx` file in the standard `OverallActivityReport_*` shape.

### Command

```bash
cd backend
npm run ingest:excel -- --file="C:/Users/dell/Downloads/OverallActivityReport_20260514_145352.xlsx"
```

Optional flags:

| Flag | Default | Effect |
|------|---------|--------|
| `--mode=replace` | yes | Wipes `login_history` / `video_usage` / `mcq_report` first. Use when the Excel is a full export. |
| `--mode=append` | — | Keeps existing rows. Use when adding incremental data. |

### What the Excel reader expects

Sheet names (case-insensitive; missing/empty sheets are tolerated):

| Sheet | Maps to | Required columns |
|-------|---------|------------------|
| `Login History` | `users` + `login_history` | `Student/Teacher, School, UserID, EnrollmentID, StudentName, Division, EmailID, Gender, LoginDate, LoginTime, LogoutDate, LogoutTime, SessionTime` |
| `Video Usage` | `users` + `video_usage` | `Student/Teacher, School, UserID, EnrollmentID, StudentName, Division, EmailID, Gender, Course, Subject, Chapter, ContentName, ContentType, TotalViewDuration, TotalViewCount, LastAccessDate, LastAccessTime` |
| `MCQ Report` | `users` + `mcq_report` | `Student/Teacher, School, UserID, EnrollmentID, StudentName, Division, EmailID, Gender, Course, Subject, Chapter, TotalQuestion, RightQuestionCount, TotalMarks, MarksObtained, Percentage, AttemptedDate, AttemptedTime, TimeSpent` |

Other sheets in the workbook (`Login Summary`, `MCQ Pivot`, `Institute Corner`, etc.) are **ignored** — they're pivots/summaries derived from the three above.

Users are deduplicated by `UserID` across all three sheets.

### Field conversions

Times are stored **raw** in `TIME` columns — what you see in MySQL Workbench is the same `H:MM:SS` string the Excel/API gave us. Numeric conversions (seconds, ms) happen at query time in the API layer via `TIME_TO_SEC()`.

| Excel value | Stored as | Example in DB |
|---|---|---|
| `"2/26/26"` | `DATE` | `2026-02-26` |
| `"12:23:04"` (wall-clock) | `TIME` | `12:23:04` |
| `"0:04:19"` (duration) | `TIME` | `00:04:19` |
| `"66.67"` | `DECIMAL(5,2)` | `66.67` |
| empty cell | `NULL` | — |

Unparseable date/time cells become `NULL` rather than aborting — check the console for warnings.

> **Why TIME, not BIGINT ms?** You can read the column directly in any MySQL client — no math required to know when a student logged in. Aggregations stay efficient because `TIME_TO_SEC` is a simple cast.

### Expected output

```
[ingest] source=excel mode=replace file=C:/Users/.../report.xlsx
[ingest] reading Excel...
[ingest] parsed: 412 users, 0 logins, 1376 videos, 30 mcq
[ingest] writing to MySQL...
[ingest] done: { users: 412, logins: 0, videos: 1376, mcq: 30, mode: 'replace' }
```

---

## Flow 1 — Senior sir's API (use this later)

Right now `sources/api.ts` is a **stub that throws** — calling it crashes on purpose so we don't silently load empty data.

### When the API spec arrives

1. Add `SENIOR_API_URL` (and `SENIOR_API_TOKEN` if needed) to `backend/.env`.
2. Open `backend/src/ingest/sources/api.ts` and implement `readFromApi()`:
   - Make whatever HTTP calls the senior's API requires.
   - Map the response into the `IngestBatch` shape (same as the Excel reader).
   - Use the same transformers (`parseDate`, `parseTimeToMs`, …) so parsing stays consistent.
3. Optionally schedule it (Windows Task Scheduler, cron, or a `setInterval` worker).

### Command (once implemented)

```bash
cd backend
npm run ingest:api
```

Same `--mode=replace` / `--mode=append` flags apply.

---

## When you re-run ingest

| Table | What happens | Why |
|-------|--------------|-----|
| `users` | UPSERT on `user_id`. Non-null fields from the new row win; null fields don't clobber existing values. | Same student appears across many rows; we want the latest profile data. |
| `login_history` | `replace`: TRUNCATE + INSERT.   `append`: INSERT. | These tables are full exports — replacing avoids duplicate sessions. |
| `video_usage` | Same as login_history. | Same reasoning. |
| `mcq_report` | Same as login_history. | Same reasoning. |

The whole load runs **inside one transaction** — a SQL failure halfway through rolls back, you don't end up half-loaded.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Access denied for user` | wrong `DB_PASSWORD` in `.env` | Update `.env`, retry |
| `Table 'eclass_analytics.users' doesn't exist` | schema not created | Run `sql/schema.sql` |
| `parsed: 0 users, 0 logins, 0 videos, 0 mcq` from Excel | wrong sheet names or empty sheets | Open the file in Excel and confirm sheet names match the list above |
| Lots of `NULL` `login_date` rows | Excel cells stored as Excel-native dates (not strings) | The reader uses `raw: false` which usually converts them; if not, open the file and re-save the date column as text or fix the column type |
| `readFromApi() not yet implemented` | tried `--source=api` before implementing | Implement `sources/api.ts` or fall back to `--source=excel` |

---

## Adding a new source (e.g. CSV, S3 file, message queue)

1. Add `backend/src/ingest/sources/<name>.ts` exporting a function that returns `Promise<IngestBatch>` (or `IngestBatch`).
2. Re-use `transformers.ts` for date/time/number parsing — keep parsing rules in one place.
3. Add a branch in `cli.ts → main()` for the new `--source=<name>`.
4. Add an `npm run ingest:<name>` script to `package.json`.
5. Document it here.

The loader and the DB schema do not change.
