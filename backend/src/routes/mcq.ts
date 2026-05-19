import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { FilterQuerySchema, buildWhereClause } from "../lib/filters.js";

const router = Router();

/**
 * GET /api/mcq/results
 * Aggregated MCQ stats — overall summary + per-subject breakdown.
 * Feeds McqResultsCard.
 */
router.get(
  "/results",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);

    const mcq = buildWhereClause(filter, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });

    const [summaryRows] = await pool.query<any[]>(
      `SELECT COUNT(*) AS attempts,
              COALESCE(AVG(mr.percentage), 0)           AS avgPercentage,
              COALESCE(SUM(mr.right_question_count), 0) AS rightAnswers,
              COALESCE(SUM(mr.total_question), 0)       AS totalQuestions,
              COALESCE(SUM(mr.marks_obtained), 0)       AS marksObtained,
              COALESCE(SUM(mr.total_marks), 0)          AS totalMarks,
              COUNT(DISTINCT mr.user_id)                AS uniqueStudents
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    const [subjectRows] = await pool.query<any[]>(
      `SELECT mr.subject AS subject,
              mr.course  AS course,
              COUNT(*)                                  AS attempts,
              COALESCE(AVG(mr.percentage), 0)           AS avgPercentage,
              COALESCE(SUM(mr.right_question_count), 0) AS rightAnswers,
              COALESCE(SUM(mr.total_question), 0)       AS totalQuestions,
              COUNT(DISTINCT mr.user_id)                AS uniqueStudents
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.subject, mr.course
       ORDER BY attempts DESC
       LIMIT ?`,
      [...mcq.params, limit],
    );

    res.json({
      summary: {
        attempts:       Number(summaryRows[0]?.attempts ?? 0),
        avgPercentage:  Number(summaryRows[0]?.avgPercentage ?? 0),
        rightAnswers:   Number(summaryRows[0]?.rightAnswers ?? 0),
        totalQuestions: Number(summaryRows[0]?.totalQuestions ?? 0),
        marksObtained:  Number(summaryRows[0]?.marksObtained ?? 0),
        totalMarks:     Number(summaryRows[0]?.totalMarks ?? 0),
        uniqueStudents: Number(summaryRows[0]?.uniqueStudents ?? 0),
      },
      items: subjectRows.map((r) => ({
        subject: r.subject,
        course: r.course,
        attempts: Number(r.attempts),
        avgPercentage: Number(r.avgPercentage),
        rightAnswers: Number(r.rightAnswers),
        totalQuestions: Number(r.totalQuestions),
        uniqueStudents: Number(r.uniqueStudents),
      })),
    });
  }),
);

/**
 * GET /api/mcq/overview
 * Per-course → per-subject MCQ accuracy + score-distribution buckets.
 * Feeds the dashboard's McqResultsCard.
 */
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const filter = FilterQuerySchema.parse(req.query);

    const mcq = buildWhereClause(filter, {
      dateColumn: "mr.attempted_date",
      schoolColumn: "u.school",
      courseColumn: "mr.course",
      divisionColumn: "u.division",
      genderColumn: "u.gender",
    });

    const [summaryRows] = await pool.query<any[]>(
      `SELECT COUNT(*)                                            AS totalAttempts,
              COALESCE(AVG(mr.percentage), 0)                     AS avgPercentage,
              COUNT(DISTINCT mr.user_id)                          AS uniqueStudents,
              COALESCE(AVG(TIME_TO_SEC(mr.time_spent)), 0) * 1000 AS avgTimeSpentMs
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    const [courseSubjectRows] = await pool.query<any[]>(
      `SELECT mr.course AS course,
              mr.subject AS subject,
              COUNT(*)                        AS attempts,
              COALESCE(AVG(mr.percentage), 0) AS avgPercentage
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.course, mr.subject`,
      mcq.params,
    );

    const [courseStudentRows] = await pool.query<any[]>(
      `SELECT mr.course AS course, COUNT(DISTINCT mr.user_id) AS students
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}
       GROUP BY mr.course`,
      mcq.params,
    );

    const [bucketRows] = await pool.query<any[]>(
      `SELECT
         SUM(CASE WHEN mr.percentage <  20                      THEN 1 ELSE 0 END) AS b0,
         SUM(CASE WHEN mr.percentage >= 20 AND mr.percentage < 40 THEN 1 ELSE 0 END) AS b1,
         SUM(CASE WHEN mr.percentage >= 40 AND mr.percentage < 60 THEN 1 ELSE 0 END) AS b2,
         SUM(CASE WHEN mr.percentage >= 60 AND mr.percentage < 80 THEN 1 ELSE 0 END) AS b3,
         SUM(CASE WHEN mr.percentage >= 80                      THEN 1 ELSE 0 END) AS b4
       FROM mcq_report mr
       JOIN users u ON u.user_id = mr.user_id
       ${mcq.where}`,
      mcq.params,
    );

    type SubjBreakdown = { subject: string; attempts: number; avgPercentage: number };
    type CourseBreakdown = {
      course: string;
      attempts: number;
      avgPercentage: number;  // weighted by attempts
      students: number;
      subjects: SubjBreakdown[];
      _wpct: number;
    };
    const map = new Map<string, CourseBreakdown>();
    for (const r of courseSubjectRows) {
      const course = r.course;
      if (!course) continue;
      const subject = r.subject || "(Unspecified)";
      if (!map.has(course)) {
        map.set(course, {
          course, attempts: 0, avgPercentage: 0, students: 0, subjects: [], _wpct: 0,
        });
      }
      const c = map.get(course)!;
      const attempts = Number(r.attempts);
      const pct = Number(r.avgPercentage);
      c.attempts += attempts;
      c._wpct += pct * attempts;
      c.subjects.push({ subject, attempts, avgPercentage: pct });
    }
    for (const r of courseStudentRows) {
      const c = map.get(r.course);
      if (c) c.students = Number(r.students);
    }

    const courses = [...map.values()]
      .map((c) => ({
        course: c.course,
        attempts: c.attempts,
        avgPercentage: c.attempts > 0 ? c._wpct / c.attempts : 0,
        students: c.students,
        subjects: c.subjects.sort((a, b) => b.attempts - a.attempts),
      }))
      .sort((a, b) => b.attempts - a.attempts);

    const b = bucketRows[0] ?? {};
    res.json({
      totalAttempts:   Number(summaryRows[0]?.totalAttempts ?? 0),
      avgPercentage:   Number(summaryRows[0]?.avgPercentage ?? 0),
      uniqueStudents:  Number(summaryRows[0]?.uniqueStudents ?? 0),
      avgTimeSpentMs:  Number(summaryRows[0]?.avgTimeSpentMs ?? 0),
      courses,
      scoreDistribution: [
        { bucket: "0–20%",   count: Number(b.b0 ?? 0) },
        { bucket: "20–40%",  count: Number(b.b1 ?? 0) },
        { bucket: "40–60%",  count: Number(b.b2 ?? 0) },
        { bucket: "60–80%",  count: Number(b.b3 ?? 0) },
        { bucket: "80–100%", count: Number(b.b4 ?? 0) },
      ],
    });
  }),
);

export default router;
