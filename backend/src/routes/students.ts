import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/students
 * Per-student aggregated stats. Feeds StudentList and StudentBreakdownChart.
 * Query params:
 *   limit  — max students to return (default 200, hard cap 1000)
 *   sort   — one of: logins | sessionMs | videoViews | mcqAttempts (default logins)
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000);
    const sortKey = String(req.query.sort ?? "logins");
    const sortColumns: Record<string, string> = {
      logins: "logins",
      sessionMs: "totalSessionMs",
      videoViews: "videoViews",
      mcqAttempts: "mcqAttempts",
    };
    const orderBy = sortColumns[sortKey] ?? "logins";

    const login = buildWhereClause(filter, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [loginRows] = await pool.query<any[]>(
      `SELECT lh.user_id AS userId,
              COUNT(*)                                                            AS logins,
              SUM(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60 THEN 1 ELSE 0 END) AS activeSessions,
              COALESCE(SUM(TIME_TO_SEC(lh.session_time)), 0) * 1000               AS totalSessionMs
       FROM login_history lh
       JOIN users u ON u.user_id = lh.user_id
       ${login.where}
       GROUP BY lh.user_id`,
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
      `SELECT vu.user_id AS userId,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.user_id`,
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
      `SELECT mr.user_id AS userId,
              COUNT(*)                        AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.user_id`,
      mcq.params,
    );

    type Row = {
      userId: number;
      enrollmentId: string | null;
      studentName: string | null;
      school: string | null;
      division: string | null;
      logins: number;
      activeSessions: number;
      totalSessionMs: number;
      videoViews: number;
      videoWatchMs: number;
      mcqAttempts: number;
      avgPercentage: number;
    };
    const map = new Map<number, Row>();
    const ids = new Set<number>();
    for (const r of loginRows) ids.add(Number(r.userId));
    for (const r of videoRows) ids.add(Number(r.userId));
    for (const r of mcqRows)   ids.add(Number(r.userId));
    if (ids.size === 0) {
      res.json({ items: [] });
      return;
    }

    const idArr = [...ids];
    const [userRows] = await pool.query<any[]>(
      `SELECT user_id, enrollment_id, student_name, school, division
       FROM users WHERE user_id IN (${idArr.map(() => "?").join(",")})`,
      idArr,
    );
    for (const u of userRows) {
      map.set(Number(u.user_id), {
        userId: Number(u.user_id),
        enrollmentId: u.enrollment_id ?? null,
        studentName: u.student_name ?? null,
        school: u.school ?? null,
        division: u.division ?? null,
        logins: 0, activeSessions: 0, totalSessionMs: 0,
        videoViews: 0, videoWatchMs: 0,
        mcqAttempts: 0, avgPercentage: 0,
      });
    }
    for (const r of loginRows) {
      const x = map.get(Number(r.userId));
      if (!x) continue;
      x.logins = Number(r.logins);
      x.activeSessions = Number(r.activeSessions);
      x.totalSessionMs = Number(r.totalSessionMs);
    }
    for (const r of videoRows) {
      const x = map.get(Number(r.userId));
      if (!x) continue;
      x.videoViews = Number(r.videoViews);
      x.videoWatchMs = Number(r.videoWatchMs);
    }
    for (const r of mcqRows) {
      const x = map.get(Number(r.userId));
      if (!x) continue;
      x.mcqAttempts = Number(r.mcqAttempts);
      x.avgPercentage = Number(r.avgPercentage);
    }

    const items = [...map.values()]
      .sort((a, b) => (b[orderBy as keyof Row] as number) - (a[orderBy as keyof Row] as number))
      .slice(0, limit);

    res.json({ items, totalStudents: map.size });
  }),
);

export default router;
