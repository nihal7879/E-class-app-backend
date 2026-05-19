import { Router } from "express";
import { pool } from "../db.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = Router();

/**
 * GET /api/filters/catalogue
 * Returns every distinct value that populates the FilterBar dropdowns.
 * Drives the frontend's getCatalogue() replacement.
 */
router.get(
  "/catalogue",
  asyncHandler(async (_req, res) => {
    const [yearRows] = await pool.query<any[]>(
      `SELECT DISTINCT y FROM (
         SELECT YEAR(login_date)       AS y FROM login_history WHERE login_date IS NOT NULL
         UNION SELECT YEAR(last_access_date) FROM video_usage    WHERE last_access_date IS NOT NULL
         UNION SELECT YEAR(attempted_date)   FROM mcq_report     WHERE attempted_date IS NOT NULL
       ) t WHERE y IS NOT NULL ORDER BY y DESC`,
    );

    const [monthRows] = await pool.query<any[]>(
      `SELECT DISTINCT m FROM (
         SELECT MONTH(login_date)       AS m FROM login_history WHERE login_date IS NOT NULL
         UNION SELECT MONTH(last_access_date) FROM video_usage    WHERE last_access_date IS NOT NULL
         UNION SELECT MONTH(attempted_date)   FROM mcq_report     WHERE attempted_date IS NOT NULL
       ) t WHERE m IS NOT NULL ORDER BY m`,
    );

    const [schoolRows] = await pool.query<any[]>(
      `SELECT DISTINCT school FROM users WHERE school IS NOT NULL AND school <> '' ORDER BY school`,
    );

    const [courseRows] = await pool.query<any[]>(
      `SELECT DISTINCT course FROM (
         SELECT course FROM video_usage WHERE course IS NOT NULL AND course <> ''
         UNION SELECT course FROM mcq_report WHERE course IS NOT NULL AND course <> ''
       ) t ORDER BY course`,
    );

    const [divisionRows] = await pool.query<any[]>(
      `SELECT DISTINCT division FROM users WHERE division IS NOT NULL AND division <> '' ORDER BY division`,
    );

    const [genderRows] = await pool.query<any[]>(
      `SELECT DISTINCT gender FROM users WHERE gender IS NOT NULL AND gender <> '' ORDER BY gender`,
    );

    const [bounds] = await pool.query<any[]>(
      `SELECT MIN(d) AS minDate, MAX(d) AS maxDate FROM (
         SELECT login_date AS d FROM login_history WHERE login_date IS NOT NULL
         UNION ALL SELECT last_access_date FROM video_usage    WHERE last_access_date IS NOT NULL
         UNION ALL SELECT attempted_date   FROM mcq_report     WHERE attempted_date   IS NOT NULL
       ) t`,
    );

    res.json({
      years: yearRows.map((r) => r.y),
      months: monthRows.map((r) => r.m),
      schools: schoolRows.map((r) => r.school),
      courses: courseRows.map((r) => r.course),
      divisions: divisionRows.map((r) => r.division),
      genders: genderRows.map((r) => r.gender),
      minDate: bounds[0]?.minDate ?? null,
      maxDate: bounds[0]?.maxDate ?? null,
    });
  }),
);

export default router;
