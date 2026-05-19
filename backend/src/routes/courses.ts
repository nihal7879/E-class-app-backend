import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/courses/:course
 * Course-level KPIs (videos + MCQs). login_history has no course column,
 * so login metrics are not part of this response.
 */
router.get(
  "/:course",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const course = decodeURIComponent(req.params.course);

    const video = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.user_id)                                   AS uniqueStudents,
              COUNT(DISTINCT vu.subject)                                   AS subjects,
              COUNT(DISTINCT u.school)                                     AS schools
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}`,
      video.params,
    );

    const mcq = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage,
              COALESCE(SUM(mr.right_question_count), 0) AS rightAnswers,
              COALESCE(SUM(mr.total_question), 0)       AS totalQuestions
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    res.json({
      course,
      videoViews:     Number(videoRows[0]?.videoViews ?? 0),
      videoWatchMs:   Number(videoRows[0]?.videoWatchMs ?? 0),
      uniqueStudents: Number(videoRows[0]?.uniqueStudents ?? 0),
      subjects:       Number(videoRows[0]?.subjects ?? 0),
      schools:        Number(videoRows[0]?.schools ?? 0),
      mcqAttempts:    Number(mcqRows[0]?.mcqAttempts ?? 0),
      avgPercentage:  Number(mcqRows[0]?.avgPercentage ?? 0),
      rightAnswers:   Number(mcqRows[0]?.rightAnswers ?? 0),
      totalQuestions: Number(mcqRows[0]?.totalQuestions ?? 0),
    });
  }),
);

/**
 * GET /api/courses/:course/subjects
 * Per-subject breakdown within a single course.
 */
router.get(
  "/:course/subjects",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const course = decodeURIComponent(req.params.course);

    const video = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT vu.subject AS subject,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.chapter)                                   AS chapters,
              COUNT(DISTINCT vu.user_id)                                   AS students
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY vu.subject`,
      video.params,
    );

    const mcq = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT mr.subject AS subject,
              COUNT(*)                        AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.subject`,
      mcq.params,
    );

    type Row = {
      subject: string;
      videoViews: number;
      videoWatchMs: number;
      chapters: number;
      students: number;
      mcqAttempts: number;
      avgPercentage: number;
    };
    const map = new Map<string, Row>();
    const get = (subject: string): Row => {
      if (!map.has(subject)) {
        map.set(subject, {
          subject, videoViews: 0, videoWatchMs: 0, chapters: 0, students: 0,
          mcqAttempts: 0, avgPercentage: 0,
        });
      }
      return map.get(subject)!;
    };
    for (const r of videoRows) {
      if (!r.subject) continue;
      const x = get(r.subject);
      x.videoViews = Number(r.videoViews);
      x.videoWatchMs = Number(r.videoWatchMs);
      x.chapters = Number(r.chapters);
      x.students = Number(r.students);
    }
    for (const r of mcqRows) {
      if (!r.subject) continue;
      const x = get(r.subject);
      x.mcqAttempts = Number(r.mcqAttempts);
      x.avgPercentage = Number(r.avgPercentage);
    }

    res.json({
      course,
      items: [...map.values()].sort((a, b) => b.videoViews - a.videoViews),
    });
  }),
);

/**
 * GET /api/courses/:course/schools
 * Per-school breakdown for a single course. Feeds CourseOverviewPage's
 * "Schools using this standard" table.
 */
router.get(
  "/:course/schools",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const course = decodeURIComponent(req.params.course);

    const video = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "vu.last_access_date",
      schoolColumn: "u.school",
      courseColumn: "vu.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [videoRows] = await pool.query<any[]>(
      `SELECT u.school AS school,
              COALESCE(SUM(vu.total_view_count), 0)                        AS videoViews,
              COALESCE(SUM(TIME_TO_SEC(vu.total_view_duration)), 0) * 1000 AS videoWatchMs,
              COUNT(DISTINCT vu.user_id)                                   AS students
       FROM video_usage vu
       JOIN users u ON u.user_id = vu.user_id
       ${video.where}
       GROUP BY u.school`,
      video.params,
    );

    const mcq = buildWhereClause({ ...filter, courses: [course] }, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });
    const [mcqRows] = await pool.query<any[]>(
      `SELECT u.school AS school,
              COUNT(*)                        AS mcqAttempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY u.school`,
      mcq.params,
    );

    type Row = {
      school: string;
      students: number;
      videoViews: number;
      videoWatchMs: number;
      mcqAttempts: number;
      avgPercentage: number;
    };
    const map = new Map<string, Row>();
    const get = (school: string): Row => {
      if (!map.has(school)) {
        map.set(school, { school, students: 0, videoViews: 0, videoWatchMs: 0, mcqAttempts: 0, avgPercentage: 0 });
      }
      return map.get(school)!;
    };
    for (const r of videoRows) {
      if (!r.school) continue;
      const x = get(r.school);
      x.students = Number(r.students);
      x.videoViews = Number(r.videoViews);
      x.videoWatchMs = Number(r.videoWatchMs);
    }
    for (const r of mcqRows) {
      if (!r.school) continue;
      const x = get(r.school);
      x.mcqAttempts = Number(r.mcqAttempts);
      x.avgPercentage = Number(r.avgPercentage);
    }

    res.json({
      course,
      items: [...map.values()].sort((a, b) => b.videoViews - a.videoViews),
    });
  }),
);

export default router;
