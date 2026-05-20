import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/kpis
 * Headline numbers for the KPI strip:
 *   - total logins, total session ms, avg session ms, unique users
 *   - total video views, total video watch ms
 *   - total mcq attempts, avg mcq percentage
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);

    const login = buildWhereClause(filter, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    // "session" = login with session_time >= 1 minute (skip instant-logout rows).
    // "logins"  = every login_history row, raw.
    const [loginRows] = await pool.query<any[]>(
      `SELECT
         COUNT(*)                                                   AS totalLogins,
         SUM(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60 THEN 1 ELSE 0 END) AS activeSessions,
         COALESCE(SUM(TIME_TO_SEC(lh.session_time)), 0) * 1000       AS totalSessionMs,
         COALESCE(AVG(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60
                           THEN TIME_TO_SEC(lh.session_time) END), 0) * 1000 AS avgSessionMs
       FROM login_history lh
       JOIN users u ON u.user_id = lh.user_id
       ${login.where}`,
      login.params,
    );

    const video = buildWhereClause(filter, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT
         COALESCE(SUM(vu.total_view_count), 0)                          AS videoViews,
         COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000   AS videoWatchMs
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}`,
      video.params,
    );

    const mcq = buildWhereClause(filter, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT
         COUNT(*)                          AS mcqAttempts,
         COALESCE(AVG(mr.percentage), 0)   AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    // Distinct schools + unique learners that have ANY activity inside the
    // filter window. Union across logins + videos + mcq so a student with
    // only video activity (and no logins recorded in the window) still counts.
    const unionLogin = buildWhereClause(filter, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const unionVideo = buildWhereClause(filter, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const unionMcq = buildWhereClause(filter, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [schoolCountRows] = await pool.query<any[]>(
      `SELECT COUNT(DISTINCT s) AS n FROM (
         SELECT u.school AS s FROM login_history lh JOIN users u ON u.user_id = lh.user_id ${unionLogin.where}
         UNION
         SELECT u.school AS s FROM video_usage vu  JOIN users u ON u.user_id = vu.user_id ${unionVideo.where}
       ) t WHERE s IS NOT NULL AND s <> ''`,
      [...unionLogin.params, ...unionVideo.params],
    );

    const [uniqueUserRows] = await pool.query<any[]>(
      `SELECT COUNT(DISTINCT uid) AS n FROM (
         SELECT lh.user_id AS uid FROM login_history lh JOIN users u ON u.user_id = lh.user_id ${unionLogin.where}
         UNION
         SELECT vu.user_id AS uid FROM video_usage vu  JOIN users u ON u.user_id = vu.user_id ${unionVideo.where}
         UNION
         SELECT mr.user_id AS uid FROM mcq_report mr   JOIN users u ON u.user_id = mr.user_id ${unionMcq.where}
       ) t WHERE uid IS NOT NULL`,
      [...unionLogin.params, ...unionVideo.params, ...unionMcq.params],
    );

    const [courseCountRows] = await pool.query<any[]>(
      `SELECT COUNT(DISTINCT vu.course) AS n
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where ? video.where + " AND " : " WHERE "}vu.course IS NOT NULL AND vu.course <> ''`,
      video.params,
    );

    res.json({
      totalLogins:    Number(loginRows[0]?.totalLogins ?? 0),
      activeSessions: Number(loginRows[0]?.activeSessions ?? 0),
      totalSessionMs: Number(loginRows[0]?.totalSessionMs ?? 0),
      avgSessionMs:   Number(loginRows[0]?.avgSessionMs ?? 0),
      uniqueUsers:    Number(uniqueUserRows[0]?.n ?? 0),
      videoViews:     Number(videoRows[0]?.videoViews ?? 0),
      videoWatchMs:   Number(videoRows[0]?.videoWatchMs ?? 0),
      mcqAttempts:    Number(mcqRows[0]?.mcqAttempts ?? 0),
      avgPercentage:  Number(mcqRows[0]?.avgPercentage ?? 0),
      totalSchools:   Number(schoolCountRows[0]?.n ?? 0),
      totalCourses:   Number(courseCountRows[0]?.n ?? 0),
    });
  }),
);

export default router;
