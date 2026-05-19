import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/videos/usage
 * Aggregated video usage grouped by content_name. Feeds VideoUsageCard.
 * Query params:
 *   limit  — max items to return (default 50)
 */
router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);

    const video = buildWhereClause(filter, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });

    const [summaryRows] = await pool.query<any[]>(
      `SELECT COALESCE(SUM(vu.total_view_count), 0)                        AS totalViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS totalWatchMs,
              COUNT(DISTINCT vu.content_name)                              AS uniqueVideos,
              COUNT(DISTINCT vu.user_id)                                   AS uniqueViewers
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}`,
      video.params,
    );

    const [itemRows] = await pool.query<any[]>(
      `SELECT vu.content_name AS contentName,
              vu.content_type AS contentType,
              vu.subject      AS subject,
              vu.chapter      AS chapter,
              vu.course       AS course,
              COALESCE(SUM(vu.total_view_count), 0)                        AS totalViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS totalWatchMs,
              COUNT(DISTINCT vu.user_id)                                   AS uniqueViewers
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.content_name, vu.content_type, vu.subject, vu.chapter, vu.course
       ORDER BY totalViews DESC
       LIMIT ?`,
      [...video.params, limit],
    );

    res.json({
      summary: {
        totalViews:    Number(summaryRows[0]?.totalViews ?? 0),
        totalWatchMs:  Number(summaryRows[0]?.totalWatchMs ?? 0),
        uniqueVideos:  Number(summaryRows[0]?.uniqueVideos ?? 0),
        uniqueViewers: Number(summaryRows[0]?.uniqueViewers ?? 0),
      },
      items: itemRows.map((r) => ({
        contentName: r.contentName,
        contentType: r.contentType,
        subject: r.subject,
        chapter: r.chapter,
        course: r.course,
        totalViews: Number(r.totalViews),
        totalWatchMs: Number(r.totalWatchMs),
        uniqueViewers: Number(r.uniqueViewers),
      })),
    });
  }),
);

/**
 * GET /api/videos/overview
 * Per-course → per-subject watch-time breakdown + content-type mix.
 * Feeds the dashboard's VideoUsageCard.
 */
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);

    const video = buildWhereClause(filter, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });

    const [summaryRows] = await pool.query<any[]>(
      `SELECT COUNT(*)                                                       AS totalViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000   AS totalDurationMs,
              COUNT(DISTINCT vu.user_id)                                     AS uniqueStudents,
              COUNT(DISTINCT CONCAT_WS(0x1F, vu.course, vu.subject, vu.chapter, vu.content_name)) AS uniqueContent
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}`,
      video.params,
    );

    const [courseSubjectRows] = await pool.query<any[]>(
      `SELECT vu.course AS course,
              vu.subject AS subject,
              COUNT(*)                                                     AS views,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS durationMs,
              COUNT(DISTINCT vu.user_id)                                   AS students
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.course, vu.subject`,
      video.params,
    );

    const [typeRows] = await pool.query<any[]>(
      `SELECT vu.content_type AS type,
              COUNT(*)                                                     AS views,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS durationMs
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.content_type
       ORDER BY views DESC`,
      video.params,
    );

    type SubjBreakdown = { subject: string; durationMs: number; views: number };
    type CourseBreakdown = {
      course: string;
      durationMs: number;
      views: number;
      students: number;
      _studentIds: Set<string>;
      subjects: SubjBreakdown[];
    };
    const map = new Map<string, CourseBreakdown>();
    for (const r of courseSubjectRows) {
      const course = r.course;
      if (!course) continue;
      const subject = r.subject || "(Unspecified)";
      if (!map.has(course)) {
        map.set(course, {
          course, durationMs: 0, views: 0, students: 0, _studentIds: new Set(), subjects: [],
        });
      }
      const c = map.get(course)!;
      c.durationMs += Number(r.durationMs);
      c.views += Number(r.views);
      // student counts are union-aware via separate query below; placeholder for now
      c.subjects.push({
        subject,
        durationMs: Number(r.durationMs),
        views: Number(r.views),
      });
    }

    // Per-course distinct student counts (subject groupings can double-count).
    const [courseStudentRows] = await pool.query<any[]>(
      `SELECT vu.course AS course, COUNT(DISTINCT vu.user_id) AS students
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.course`,
      video.params,
    );
    for (const r of courseStudentRows) {
      const c = map.get(r.course);
      if (c) c.students = Number(r.students);
    }

    const courses = [...map.values()]
      .map((c) => ({
        course: c.course,
        durationMs: c.durationMs,
        views: c.views,
        students: c.students,
        subjects: c.subjects.sort((a, b) => b.durationMs - a.durationMs),
      }))
      .sort((a, b) => b.durationMs - a.durationMs);

    res.json({
      totalViews:      Number(summaryRows[0]?.totalViews ?? 0),
      totalDurationMs: Number(summaryRows[0]?.totalDurationMs ?? 0),
      uniqueStudents:  Number(summaryRows[0]?.uniqueStudents ?? 0),
      uniqueContent:   Number(summaryRows[0]?.uniqueContent ?? 0),
      courses,
      contentTypeMix: typeRows.map((r) => ({
        type: r.type || "Other",
        views: Number(r.views),
        durationMs: Number(r.durationMs),
      })),
    });
  }),
);

export default router;
