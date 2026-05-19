# E-class Analytics — Backend API Reference

Base URL: `http://localhost:4000`

All endpoints return JSON. All filter-aware endpoints accept the same query-parameter contract — documented once in **Common filter query params** below, then referenced as `[filter]` in each endpoint.

---

## Table of contents

| # | Endpoint | Frontend consumer |
|---|----------|-------------------|
| 1 | `GET /api/health` | (dev / monitoring) |
| 2 | `GET /api/filters/catalogue` | `FilterBar` dropdowns |
| 3 | `GET /api/kpis` | `KpiStrip` |
| 4 | `GET /api/activity/daily` | `DailyActivityChart` |
| 5 | `GET /api/schools/composition` | `SchoolCompositionChart` |
| 6 | `GET /api/schools/:school` | `SchoolDetailPage` |
| 7 | `GET /api/schools/:school/courses` | `SchoolCoursesPage` |
| 8 | `GET /api/courses/:course` | `CourseOverviewPage` |
| 9 | `GET /api/courses/:course/subjects` | `CourseSubjectsPage` |
| 10 | `GET /api/subjects/:subject` | `SubjectDetailPage` |
| 11 | `GET /api/videos/usage` | `VideoUsageCard` |
| 12 | `GET /api/mcq/results` | `McqResultsCard` |
| 13 | `GET /api/students` | `StudentList`, `StudentBreakdownChart` |

---

## Common filter query params

Accepted by every data endpoint (#3 onward). All are optional. Defined in `backend/src/lib/filters.ts`.

| Param | Type | Default | Meaning |
|---|---|---|---|
| `year` | number \| `"all"` | `"all"` | Calendar year (e.g. `2026`). Ignored when `dateFrom`/`dateTo` provided. |
| `month` | 1..12 \| `"all"` | `"all"` | Calendar month. Ignored when `dateFrom`/`dateTo` provided. |
| `schools` | CSV string | `""` | Comma-separated school names. Empty = all. |
| `courses` | CSV string | `""` | Comma-separated course names. Empty = all. |
| `divisions` | CSV string | `""` | Comma-separated division names. Empty = all. |
| `genders` | CSV string | `""` | Comma-separated genders. Empty = all. |
| `dateFrom` | `YYYY-MM-DD` | — | Inclusive lower bound. Overrides `year`/`month` when set. |
| `dateTo` | `YYYY-MM-DD` | — | Inclusive upper bound. Overrides `year`/`month` when set. |

**Notes**
- `login_history` has no course column — `courses` filter is **ignored** for login-derived metrics.
- Each endpoint applies the date filter against its own dataset's date column (login_date / last_access_date / attempted_date).
- Invalid params return HTTP 400 with `{ error: "Invalid query parameters", details: {...} }`.

Example query string referenced everywhere as `[filter]`:
```
?year=2026&month=5&schools=DPS,Riverdale&courses=Physics&divisions=10A&genders=Male
```

---

## 1. `GET /api/health`

Server liveness + DB ping.

**Query params:** none.

**Response**
```json
{
  "status": "ok",
  "db": "connected",
  "time": "2026-05-18T10:32:11.123Z"
}
```
`db` is `"unreachable"` if the MySQL pool can't ping.

---

## 2. `GET /api/filters/catalogue`

Distinct values that populate the `FilterBar` dropdowns.

**Query params:** none (returns everything available — apply filtering client-side).

**Response**
```json
{
  "years":    [2026, 2025, 2024],
  "months":   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "schools":  ["DPS Mumbai", "Riverdale Public", "..."],
  "courses":  ["Physics", "Chemistry", "..."],
  "divisions":["10A", "10B", "..."],
  "genders":  ["Female", "Male"]
}
```

---

## 3. `GET /api/kpis`

Headline numbers for the dashboard's KPI strip.

**Query params:** `[filter]`

**Response**
```json
{
  "totalLogins": 12450,
  "totalSessionMs": 8765432100,
  "avgSessionMs": 704051,
  "uniqueUsers": 1820,
  "videoViews": 34210,
  "videoWatchMs": 99876543210,
  "mcqAttempts": 5610,
  "avgPercentage": 72.34
}
```

---

## 4. `GET /api/activity/daily`

Per-day rollup of logins, video views, and MCQ attempts. Powers `DailyActivityChart`.

**Query params:** `[filter]`

**Response**
```json
{
  "series": [
    { "date": "2026-05-01", "logins": 230, "videoViews": 412, "mcqAttempts": 88 },
    { "date": "2026-05-02", "logins": 199, "videoViews": 380, "mcqAttempts": 71 }
  ]
}
```
Dates are `YYYY-MM-DD`. Series is sorted ascending. Missing-date gaps are not filled (frontend fills if needed).

---

## 5. `GET /api/schools/composition`

One row per school. Powers `SchoolCompositionChart`.

**Query params:** `[filter]`

**Response**
```json
{
  "items": [
    {
      "school": "DPS Mumbai",
      "logins": 2104,
      "sessions": 2104,
      "uniqueStudents": 312,
      "totalSessionMs": 1234567890,
      "videoViews": 5421,
      "videoDurationMs": 9876543210,
      "mcqAttempts": 980,
      "courses": 8,
      "total": 10609
    }
  ]
}
```
`total` = logins + sessions + videoViews + mcqAttempts (used for sort). Sorted by `total` desc.

---

## 6. `GET /api/schools/:school`

KPI snapshot for a single school. Feeds `SchoolDetailPage`.

**Path params**
| Name | Type | Notes |
|---|---|---|
| `school` | string | URL-encoded school name. The `schools` query filter is overridden by this path param. |

**Query params:** `[filter]`

**Response**
```json
{
  "school": "DPS Mumbai",
  "totalLogins": 2104,
  "totalSessionMs": 1234567890,
  "avgSessionMs": 586848,
  "uniqueUsers": 312,
  "videoViews": 5421,
  "videoWatchMs": 9876543210,
  "courses": 8,
  "mcqAttempts": 980,
  "avgPercentage": 71.2
}
```

---

## 7. `GET /api/schools/:school/courses`

Per-course breakdown inside one school. Feeds `SchoolCoursesPage`.

**Path params**
| Name | Type | Notes |
|---|---|---|
| `school` | string | URL-encoded. |

**Query params:** `[filter]`

**Response**
```json
{
  "school": "DPS Mumbai",
  "items": [
    {
      "course": "Physics",
      "videoViews": 1820,
      "videoWatchMs": 3211223344,
      "uniqueStudents": 142,
      "subjects": 5,
      "mcqAttempts": 310,
      "avgPercentage": 68.7
    }
  ]
}
```
Sorted by `videoViews` desc.

---

## 8. `GET /api/courses/:course`

Course-level KPIs. Feeds `CourseOverviewPage`.

> ⚠️ `login_history` has no course column, so login metrics are not part of this response.

**Path params**
| Name | Type | Notes |
|---|---|---|
| `course` | string | URL-encoded. The `courses` query filter is overridden by this path param. |

**Query params:** `[filter]`

**Response**
```json
{
  "course": "Physics",
  "videoViews": 12450,
  "videoWatchMs": 22334455667,
  "uniqueStudents": 612,
  "subjects": 5,
  "schools": 4,
  "mcqAttempts": 1810,
  "avgPercentage": 70.4,
  "rightAnswers": 13422,
  "totalQuestions": 19010
}
```

---

## 9. `GET /api/courses/:course/subjects`

Per-subject breakdown inside one course. Feeds `CourseSubjectsPage`.

**Path params**
| Name | Type | Notes |
|---|---|---|
| `course` | string | URL-encoded. |

**Query params:** `[filter]`

**Response**
```json
{
  "course": "Physics",
  "items": [
    {
      "subject": "Mechanics",
      "videoViews": 4210,
      "videoWatchMs": 8123456789,
      "chapters": 6,
      "mcqAttempts": 612,
      "avgPercentage": 69.1
    }
  ]
}
```
Sorted by `videoViews` desc.

---

## 10. `GET /api/subjects/:subject`

Subject-level KPIs + per-chapter breakdown. Feeds `SubjectDetailPage`.

**Path params**
| Name | Type | Notes |
|---|---|---|
| `subject` | string | URL-encoded. |

**Query params:** `[filter]`

**Response**
```json
{
  "subject": "Mechanics",
  "videoViews": 4210,
  "videoWatchMs": 8123456789,
  "uniqueStudents": 412,
  "chapters": 6,
  "mcqAttempts": 612,
  "avgPercentage": 69.1,
  "chapterBreakdown": [
    {
      "chapter": "Newton's Laws",
      "videoViews": 1042,
      "videoWatchMs": 2000000000,
      "contents": 8
    }
  ]
}
```
`chapterBreakdown` is sorted by `videoViews` desc.

---

## 11. `GET /api/videos/usage`

Aggregated video usage. Feeds `VideoUsageCard`.

**Query params:** `[filter]` plus:
| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `limit` | int | 50 | 500 | Top-N videos returned in `items`. |

**Response**
```json
{
  "summary": {
    "totalViews": 34210,
    "totalWatchMs": 99876543210,
    "uniqueVideos": 412,
    "uniqueViewers": 1820
  },
  "items": [
    {
      "contentName": "Newton's First Law — Demo",
      "contentType": "video/mp4",
      "subject": "Mechanics",
      "chapter": "Newton's Laws",
      "course": "Physics",
      "totalViews": 980,
      "totalWatchMs": 1840000000,
      "uniqueViewers": 312
    }
  ]
}
```
`items` is sorted by `totalViews` desc.

---

## 12. `GET /api/mcq/results`

MCQ summary + per-subject breakdown. Feeds `McqResultsCard`.

**Query params:** `[filter]` plus:
| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `limit` | int | 100 | 500 | Top-N subject rows returned in `items`. |

**Response**
```json
{
  "summary": {
    "attempts": 5610,
    "avgPercentage": 72.34,
    "rightAnswers": 41200,
    "totalQuestions": 57010,
    "marksObtained": 41200,
    "totalMarks": 57010,
    "uniqueStudents": 1420
  },
  "items": [
    {
      "subject": "Mechanics",
      "course": "Physics",
      "attempts": 612,
      "avgPercentage": 69.1,
      "rightAnswers": 4200,
      "totalQuestions": 6080,
      "uniqueStudents": 312
    }
  ]
}
```
`items` is sorted by `attempts` desc.

---

## 13. `GET /api/students`

Per-student aggregated stats. Feeds `StudentList` and `StudentBreakdownChart`.

**Query params:** `[filter]` plus:
| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `limit` | int | 200 | 1000 | Max students returned in `items`. |
| `sort` | string | `logins` | — | One of: `logins`, `sessionMs`, `videoViews`, `mcqAttempts`. |

**Response**
```json
{
  "items": [
    {
      "userId": 100123,
      "enrollmentId": "ENR-2026-00123",
      "studentName": "Asha R.",
      "school": "DPS Mumbai",
      "division": "10A",
      "logins": 88,
      "totalSessionMs": 12340000,
      "videoViews": 142,
      "videoWatchMs": 9876543,
      "mcqAttempts": 31,
      "avgPercentage": 78.2
    }
  ],
  "totalStudents": 1820
}
```
`totalStudents` is the unfiltered count of students matching `[filter]` (i.e. before `limit` truncation).

---

## Error responses

| HTTP | Shape | When |
|---|---|---|
| 400 | `{ "error": "Invalid query parameters", "details": { "year": ["..."] } }` | zod validation failed on `[filter]` |
| 404 | `{ "error": "Not found", "path": "/api/whatever" }` | Unknown route |
| 500 | `{ "error": "Internal server error", "message": "..." }` | Uncaught error (DB down, SQL bug, etc.) |

---

## Where things live

| File | Purpose |
|---|---|
| `src/index.ts` | Express app, CORS, error middleware, route mounting |
| `src/config.ts` | `.env` → typed `env` object (zod-validated) |
| `src/db.ts` | `mysql2/promise` connection pool + `pingDb()` |
| `src/lib/filters.ts` | `FilterQuerySchema` + `buildWhereClause()` — shared by every data endpoint |
| `src/lib/asyncHandler.ts` | wraps async handlers so rejected promises hit the error middleware |
| `src/routes/*.ts` | one file per logical resource — handlers contain SQL + response shaping |
| `sql/schema.sql` | MySQL schema (4 tables: `users`, `login_history`, `video_usage`, `mcq_report`) |

---

## Time fields — storage vs. response

| Field type | DB storage | API response |
|---|---|---|
| Per-row wall-clock (login_time, last_access_time, attempted_time) | `TIME` — raw `HH:MM:SS` | _(not currently surfaced; available via `SELECT col` if a future endpoint needs it)_ |
| Per-row duration (session_time, total_view_duration, time_spent) | `TIME` — raw `HH:MM:SS` | _(same)_ |
| Aggregated duration (`SUM`, `AVG`) | computed at query time via `TIME_TO_SEC(col) * 1000` | number, milliseconds (e.g. `totalSessionMs`, `videoWatchMs`) |

The DB stays human-readable. The API hands the frontend a numeric duration for charts and arithmetic.

---

## How filters become SQL

Single source of truth: `src/lib/filters.ts → buildWhereClause(filter, opts)`.

```ts
const filter = FilterQuerySchema.parse(req.query);          // zod validation
const { where, params } = buildWhereClause(filter, {
  dateColumn:    "lh.login_date",
  schoolColumn:  "u.school",
  divisionColumn:"u.division",
  genderColumn:  "u.gender",
  // no courseColumn — login_history has no course
});
const [rows] = await pool.query(`SELECT ... ${where}`, params);
```

`where` is either `""` (no filters) or `" WHERE col1 = ? AND col2 IN (?, ?) ..."`.
`params` is a positional array matching the `?` placeholders — passed to `mysql2` for safe parameterization. No SQL injection risk.

---

## Adding a new endpoint — checklist

1. Add `src/routes/newthing.ts` exporting a `Router`.
2. Parse query: `const filter = FilterQuerySchema.parse(req.query);`
3. Build where: `const { where, params } = buildWhereClause(filter, { ... });`
4. Query: `await pool.query(\`SELECT ... ${where}\`, params)`.
5. Mount in `src/index.ts`: `app.use("/api/newthing", newthingRouter);`
6. Document here in `docs/API.md`.
7. `npx tsc --noEmit` to confirm.
