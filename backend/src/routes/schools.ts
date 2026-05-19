import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/schools/composition
 * One row per school. Feeds SchoolCompositionChart.
 */
router.get(
  "/composition",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);

    const login = buildWhereClause(filter, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [loginRows] = await pool.query<any[]>(
      `SELECT u.school AS school,
              COUNT(*)                                                            AS logins,
              SUM(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60 THEN 1 ELSE 0 END) AS sessions,
              COUNT(DISTINCT lh.user_id)                                          AS uniqueStudents,
              COALESCE(SUM(TIME_TO_SEC(lh.session_time)), 0) * 1000               AS totalSessionMs
       FROM login_history lh
       JOIN users u ON u.user_id = lh.user_id
       ${login.where}
       GROUP BY u.school`,
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
      `SELECT u.school AS school,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoDurationMs,
              COUNT(DISTINCT vu.course)                                    AS courses
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY u.school`,
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
      `SELECT u.school AS school, COUNT(*) AS mcqAttempts
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY u.school`,
      mcq.params,
    );

    type Row = {
      school: string;
      logins: number;
      sessions: number;
      uniqueStudents: number;
      totalSessionMs: number;
      videoViews: number;
      videoDurationMs: number;
      mcqAttempts: number;
      courses: number;
      total: number;
    };
    const map = new Map<string, Row>();
    const get = (school: string): Row => {
      if (!map.has(school)) {
        map.set(school, {
          school, logins: 0, sessions: 0, uniqueStudents: 0, totalSessionMs: 0,
          videoViews: 0, videoDurationMs: 0, mcqAttempts: 0, courses: 0, total: 0,
        });
      }
      return map.get(school)!;
    };
    for (const r of loginRows) {
      const x = get(r.school);
      x.sessions = Number(r.sessions);          // active (>= 1 min)
      x.logins   = Number(r.logins);            // raw login_history rows
      x.uniqueStudents = Number(r.uniqueStudents);
      x.totalSessionMs = Number(r.totalSessionMs);
    }
    for (const r of videoRows) {
      const x = get(r.school);
      x.videoViews = Number(r.videoViews);
      x.videoDurationMs = Number(r.videoDurationMs);
      x.courses = Number(r.courses);
    }
    for (const r of mcqRows) {
      const x = get(r.school);
      x.mcqAttempts = Number(r.mcqAttempts);
    }
    for (const x of map.values()) {
      x.total = x.logins + x.sessions + x.videoViews + x.mcqAttempts;
    }

    res.json({ items: [...map.values()].sort((a, b) => b.total - a.total) });
  }),
);

/**
 * GET /api/schools/:school
 * KPI strip for a single school's detail page.
 */
router.get(
  "/:school",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const school = decodeURIComponent(req.params.school);

    const login = buildWhereClause({ ...filter, schools: [school] }, {
      dateColumn: "lh.login_date",
      schoolColumn: "u.school",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [loginRows] = await pool.query<any[]>(
      `SELECT COUNT(*)                                                            AS totalLogins,
              SUM(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60 THEN 1 ELSE 0 END) AS activeSessions,
              COALESCE(SUM(TIME_TO_SEC(lh.session_time)), 0) * 1000               AS totalSessionMs,
              COALESCE(AVG(CASE WHEN TIME_TO_SEC(lh.session_time) >= 60
                                THEN TIME_TO_SEC(lh.session_time) END), 0) * 1000 AS avgSessionMs,
              COUNT(DISTINCT lh.user_id)                                          AS uniqueUsers
       FROM login_history lh
       JOIN users u ON u.user_id = lh.user_id
       ${login.where}`,
      login.params,
    );

    const video = buildWhereClause({ ...filter, schools: [school] }, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.course)                                    AS courses
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}`,
      video.params,
    );

    const mcq = buildWhereClause({ ...filter, schools: [school] }, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    res.json({
      school,
      totalLogins:    Number(loginRows[0]?.totalLogins ?? 0),
      activeSessions: Number(loginRows[0]?.activeSessions ?? 0),
      totalSessionMs: Number(loginRows[0]?.totalSessionMs ?? 0),
      avgSessionMs:   Number(loginRows[0]?.avgSessionMs ?? 0),
      uniqueUsers:    Number(loginRows[0]?.uniqueUsers ?? 0),
      videoViews:     Number(videoRows[0]?.videoViews ?? 0),
      videoWatchMs:   Number(videoRows[0]?.videoWatchMs ?? 0),
      courses:        Number(videoRows[0]?.courses ?? 0),
      mcqAttempts:    Number(mcqRows[0]?.mcqAttempts ?? 0),
      avgPercentage:  Number(mcqRows[0]?.avgPercentage ?? 0),
    });
  }),
);

/**
 * GET /api/schools/:school/courses
 * Per-course breakdown within a single school.
 */
router.get(
  "/:school/courses",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const school = decodeURIComponent(req.params.school);

    const video = buildWhereClause({ ...filter, schools: [school] }, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT vu.course AS course,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.user_id)                                   AS uniqueStudents,
              COUNT(DISTINCT vu.subject)                                   AS subjects
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.course`,
      video.params,
    );

    const mcq = buildWhereClause({ ...filter, schools: [school] }, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT mr.course AS course,
              COUNT(*)                        AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.course`,
      mcq.params,
    );

    type Row = {
      course: string;
      videoViews: number;
      videoWatchMs: number;
      uniqueStudents: number;
      subjects: number;
      mcqAttempts: number;
      avgPercentage: number;
    };
    const map = new Map<string, Row>();
    const get = (course: string): Row => {
      if (!map.has(course)) {
        map.set(course, {
          course, videoViews: 0, videoWatchMs: 0, uniqueStudents: 0,
          subjects: 0, mcqAttempts: 0, avgPercentage: 0,
        });
      }
      return map.get(course)!;
    };
    for (const r of videoRows) {
      if (!r.course) continue;
      const x = get(r.course);
      x.videoViews = Number(r.videoViews);
      x.videoWatchMs = Number(r.videoWatchMs);
      x.uniqueStudents = Number(r.uniqueStudents);
      x.subjects = Number(r.subjects);
    }
    for (const r of mcqRows) {
      if (!r.course) continue;
      const x = get(r.course);
      x.mcqAttempts = Number(r.mcqAttempts);
      x.avgPercentage = Number(r.avgPercentage);
    }

    res.json({
      school,
      items: [...map.values()].sort((a, b) => b.videoViews - a.videoViews),
    });
  }),
);

export default router;
