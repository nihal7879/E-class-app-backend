import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/activity/daily
 * Per-day rollup of logins, video views and mcq attempts.
 * Feeds DailyActivityChart on the dashboard.
 */
router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);

    const login = buildWhereClause(filter, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [loginRows] = await pool.query<any[]>(
      `SELECT lh.login_date AS date,
              COUNT(*)                   AS logins,
              COUNT(DISTINCT lh.user_id) AS uniqueStudents
       FROM login_history lh
       JOIN users u ON u.user_id = lh.user_id
       ${login.where}
       GROUP BY lh.login_date
       ORDER BY lh.login_date`,
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
      `SELECT vu.last_access_date AS date, SUM(vu.total_view_count) AS videoViews
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.last_access_date
       ORDER BY vu.last_access_date`,
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
      `SELECT mr.attempted_date AS date, COUNT(*) AS mcqAttempts
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.attempted_date
       ORDER BY mr.attempted_date`,
      mcq.params,
    );

    const map = new Map<string, { date: string; logins: number; uniqueStudents: number; videoViews: number; mcqAttempts: number }>();
    const upsert = (date: string) => {
      if (!map.has(date)) map.set(date, { date, logins: 0, uniqueStudents: 0, videoViews: 0, mcqAttempts: 0 });
      return map.get(date)!;
    };
    for (const r of loginRows) {
      const x = upsert(r.date);
      x.logins = Number(r.logins);
      x.uniqueStudents = Number(r.uniqueStudents);
    }
    for (const r of videoRows) upsert(r.date).videoViews = Number(r.videoViews);
    for (const r of mcqRows)   upsert(r.date).mcqAttempts = Number(r.mcqAttempts);

    const series = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    res.json({ series });
  }),
);

export default router;
