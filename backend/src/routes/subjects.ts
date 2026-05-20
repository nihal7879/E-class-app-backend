import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/subjects/:subject
 * Subject-level KPIs + per-chapter breakdown for the SubjectDetailPage.
 */
router.get(
  "/:subject",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const subject = decodeURIComponent(req.params.subject);

    const video = buildWhereClause(filter, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [summaryRows] = await pool.query<any[]>(
      `SELECT COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.user_id)                                   AS uniqueStudents,
              COUNT(DISTINCT vu.chapter)                                   AS chapters
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where ? video.where + " AND " : " WHERE "}vu.subject = ?`,
      [...video.params, subject],
    );

    const [chapterRows] = await pool.query<any[]>(
      `SELECT vu.chapter AS chapter,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.content_name)                              AS contents,
              COUNT(DISTINCT vu.user_id)                                   AS students
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where ? video.where + " AND " : " WHERE "}vu.subject = ?
       GROUP BY vu.chapter
       ORDER BY videoViews DESC`,
      [...video.params, subject],
    );

    const mcq = buildWhereClause(filter, {
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
       ${mcq.where ? mcq.where + " AND " : " WHERE "}mr.subject = ?`,
      [...mcq.params, subject],
    );

    const [mcqChapterRows] = await pool.query<any[]>(
      `SELECT mr.chapter AS chapter,
              COUNT(*) AS mcqAttempts
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where ? mcq.where + " AND " : " WHERE "}mr.subject = ?
       GROUP BY mr.chapter`,
      [...mcq.params, subject],
    );

    type ChapterRow = {
      chapter: string;
      videoViews: number;
      videoWatchMs: number;
      contents: number;
      students: number;
      mcqAttempts: number;
    };
    const chapterMap = new Map<string, ChapterRow>();
    for (const r of chapterRows) {
      const key = r.chapter ?? "";
      chapterMap.set(key, {
        chapter: key,
        videoViews: Number(r.videoViews),
        videoWatchMs: Number(r.videoWatchMs),
        contents: Number(r.contents),
        students: Number(r.students ?? 0),
        mcqAttempts: 0,
      });
    }
    for (const r of mcqChapterRows) {
      const key = r.chapter ?? "";
      if (!key) continue;
      const existing = chapterMap.get(key);
      if (existing) {
        existing.mcqAttempts = Number(r.mcqAttempts);
      } else {
        chapterMap.set(key, {
          chapter: key,
          videoViews: 0,
          videoWatchMs: 0,
          contents: 0,
          students: 0,
          mcqAttempts: Number(r.mcqAttempts),
        });
      }
    }

    res.json({
      subject,
      videoViews:     Number(summaryRows[0]?.videoViews ?? 0),
      videoWatchMs:   Number(summaryRows[0]?.videoWatchMs ?? 0),
      uniqueStudents: Number(summaryRows[0]?.uniqueStudents ?? 0),
      chapters:       Number(summaryRows[0]?.chapters ?? 0),
      mcqAttempts:    Number(mcqRows[0]?.mcqAttempts ?? 0),
      avgPercentage:  Number(mcqRows[0]?.avgPercentage ?? 0),
      chapterBreakdown: [...chapterMap.values()],
    });
  }),
);

/**
 * GET /api/subjects/:subject/students
 * Per-student stats scoped to a single subject. Drives SubjectDetailPage's
 * student table.
 */
router.get(
  "/:subject/students",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const subject = decodeURIComponent(req.params.subject);

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
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoDurationMs,
              COUNT(DISTINCT vu.chapter)                                   AS chaptersTouched
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where ? video.where + " AND " : " WHERE "}vu.subject = ?
       GROUP BY vu.user_id`,
      [...video.params, subject],
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
       ${mcq.where ? mcq.where + " AND " : " WHERE "}mr.subject = ?
       GROUP BY mr.user_id`,
      [...mcq.params, subject],
    );

    const idSet = new Set<number>();
    for (const r of videoRows) idSet.add(Number(r.userId));
    for (const r of mcqRows)   idSet.add(Number(r.userId));
    if (idSet.size === 0) {
      res.json({ subject, items: [] });
      return;
    }

    const ids = [...idSet];
    const [userRows] = await pool.query<any[]>(
      `SELECT user_id, enrollment_id, student_name, division
       FROM users WHERE user_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    type Row = {
      userId: number;
      enrollmentId: string;
      studentName: string;
      division: string;
      videoViews: number;
      videoDurationMs: number;
      chaptersTouched: number;
      mcqAttempts: number;
      avgPercentage: number;
    };
    const map = new Map<number, Row>();
    for (const u of userRows) {
      map.set(Number(u.user_id), {
        userId: Number(u.user_id),
        enrollmentId: u.enrollment_id ?? "",
        studentName: u.student_name ?? "",
        division: u.division ?? "",
        videoViews: 0, videoDurationMs: 0, chaptersTouched: 0,
        mcqAttempts: 0, avgPercentage: 0,
      });
    }
    for (const r of videoRows) {
      const x = map.get(Number(r.userId));
      if (!x) continue;
      x.videoViews = Number(r.videoViews);
      x.videoDurationMs = Number(r.videoDurationMs);
      x.chaptersTouched = Number(r.chaptersTouched);
    }
    for (const r of mcqRows) {
      const x = map.get(Number(r.userId));
      if (!x) continue;
      x.mcqAttempts = Number(r.mcqAttempts);
      x.avgPercentage = Number(r.avgPercentage);
    }

    res.json({
      subject,
      items: [...map.values()].sort((a, b) => b.videoDurationMs - a.videoDurationMs),
    });
  }),
);

export default router;
