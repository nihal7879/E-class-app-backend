import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";
import type { IngestBatch } from "./types.js";

export type IngestMode = "replace" | "append";

export interface LoadResult {
  users: number;
  logins: number;
  videos: number;
  mcq: number;
  mode: IngestMode;
}

/**
 * Writes a normalized IngestBatch to MySQL inside one transaction.
 *
 *  - 'append' (default): keep existing rows. UPSERT users on user_id (latest non-null
 *                        values win). INSERT logins/videos/mcq with no dedupe. Right
 *                        for monthly increments — Jan stays when you load Feb.
 *                        WARNING: re-ingesting the same xlsx duplicates login/video/mcq
 *                        rows. Each export should contain only new data.
 *  - 'replace':          TRUNCATE users / login_history / video_usage / mcq_report,
 *                        then INSERT everything fresh from the batch. Use when
 *                        re-bootstrapping the DB from a single full export.
 */
export async function loadBatch(batch: IngestBatch, mode: IngestMode = "append"): Promise<LoadResult> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (mode === "replace") {
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      await conn.query("TRUNCATE TABLE login_history");
      await conn.query("TRUNCATE TABLE video_usage");
      await conn.query("TRUNCATE TABLE mcq_report");
      await conn.query("TRUNCATE TABLE users");
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    if (batch.users.length > 0) {
      await upsertUsers(conn, batch);
    }

    if (batch.logins.length > 0) await insertLogins(conn, batch);
    if (batch.videos.length > 0) await insertVideos(conn, batch);
    if (batch.mcq.length > 0)    await insertMcq(conn, batch);

    await conn.commit();
    return {
      users:  batch.users.length,
      logins: batch.logins.length,
      videos: batch.videos.length,
      mcq:    batch.mcq.length,
      mode,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function upsertUsers(conn: PoolConnection, batch: IngestBatch): Promise<void> {
  const sql =
    `INSERT INTO users
       (user_id, enrollment_id, student_name, email_id, gender, user_kind, school, division)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       enrollment_id = COALESCE(VALUES(enrollment_id), enrollment_id),
       student_name  = COALESCE(VALUES(student_name),  student_name),
       email_id      = COALESCE(VALUES(email_id),      email_id),
       gender        = COALESCE(VALUES(gender),        gender),
       user_kind     = COALESCE(VALUES(user_kind),     user_kind),
       school        = COALESCE(VALUES(school),        school),
       division      = COALESCE(VALUES(division),      division)`;

  for (const chunk of chunked(batch.users, 500)) {
    const values = chunk.map((u) => [
      u.userId,
      u.enrollmentId,
      u.studentName,
      u.emailId,
      u.gender,
      u.userKind ?? "Student",
      u.school,
      u.division,
    ]);
    await conn.query(sql, [values]);
  }
}

async function insertLogins(conn: PoolConnection, batch: IngestBatch): Promise<void> {
  const sql =
    `INSERT INTO login_history
       (user_id, login_date, login_time, logout_date, logout_time, session_time)
     VALUES ?`;
  for (const chunk of chunked(batch.logins, 1000)) {
    const values = chunk.map((r) => [
      r.userId, r.loginDate, r.loginTime, r.logoutDate, r.logoutTime, r.sessionTime,
    ]);
    await conn.query(sql, [values]);
  }
}

async function insertVideos(conn: PoolConnection, batch: IngestBatch): Promise<void> {
  const sql =
    `INSERT INTO video_usage
       (user_id, course, subject, chapter, content_name, content_type,
        total_view_duration, total_view_count, last_access_date, last_access_time)
     VALUES ?`;
  for (const chunk of chunked(batch.videos, 1000)) {
    const values = chunk.map((r) => [
      r.userId, r.course, r.subject, r.chapter, r.contentName, r.contentType,
      r.totalViewDuration, r.totalViewCount, r.lastAccessDate, r.lastAccessTime,
    ]);
    await conn.query(sql, [values]);
  }
}

async function insertMcq(conn: PoolConnection, batch: IngestBatch): Promise<void> {
  const sql =
    `INSERT INTO mcq_report
       (user_id, course, subject, chapter,
        total_question, right_question_count, total_marks, marks_obtained, percentage,
        attempted_date, attempted_time, time_spent)
     VALUES ?`;
  for (const chunk of chunked(batch.mcq, 1000)) {
    const values = chunk.map((r) => [
      r.userId, r.course, r.subject, r.chapter,
      r.totalQuestion, r.rightQuestionCount, r.totalMarks, r.marksObtained, r.percentage,
      r.attemptedDate, r.attemptedTime, r.timeSpent,
    ]);
    await conn.query(sql, [values]);
  }
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
