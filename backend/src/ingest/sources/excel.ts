import xlsx from "xlsx";
import type { IngestBatch, RawLogin, RawMcq, RawUser, RawVideo } from "../types.js";
import { normalizeTime, nullIfEmpty, parseDate, toFloat, toInt } from "../transformers.js";

/**
 * Reads an OverallActivityReport-style .xlsx file and produces a normalized batch.
 * Tolerant of:
 *   - missing sheets (returns empty arrays for that dataset)
 *   - empty sheets
 *   - case-insensitive sheet name lookup
 *   - extra unrelated sheets (Summary, Pivot, Institute Corner, etc. — ignored)
 *
 * Expected sheet names (case-insensitive):
 *   "Login History"   → logins  (+ users)
 *   "Video Usage"     → videos  (+ users)
 *   "MCQ Report"      → mcq     (+ users)
 *
 * Users are deduplicated by user_id across all three sheets.
 */
export function readExcel(filePath: string): IngestBatch {
  const wb = xlsx.readFile(filePath, { cellDates: false, raw: false });
  const find = (target: string) =>
    wb.SheetNames.find((n) => n.trim().toLowerCase() === target.toLowerCase());

  const loginSheet = find("Login History");
  const videoSheet = find("Video Usage");
  const mcqSheet = find("MCQ Report");

  // The e-class admin writes each data sheet as an Excel Table with a stale
  // `dimension` tag (becomes !ref in SheetJS). For Login History it's A1:M1 —
  // header only — even though 1000+ data rows are present. Recompute !ref from
  // the actual cell footprint so sheet_to_json sees every row.
  for (const name of [loginSheet, videoSheet, mcqSheet]) {
    if (name) refreshSheetRef(wb.Sheets[name]);
  }

  const userMap = new Map<number, RawUser>();
  const upsertUser = (raw: Record<string, unknown>): number | null => {
    const userId = toInt(raw["UserID"], 0);
    if (!userId) return null;
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        userKind: parseUserKind(raw["Student/Teacher"]),
        school: nullIfEmpty(raw["School"]),
        userId,
        enrollmentId: nullIfEmpty(raw["EnrollmentID"]),
        studentName: nullIfEmpty(raw["StudentName"]),
        division: nullIfEmpty(raw["Division"]),
        emailId: nullIfEmpty(raw["EmailID"]),
        gender: nullIfEmpty(raw["Gender"]),
      });
    }
    return userId;
  };

  const logins: RawLogin[] = [];
  if (loginSheet) {
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[loginSheet], {
      defval: null,
      raw: false,
    });
    for (const r of rows) {
      const userId = upsertUser(r);
      if (!userId) continue;
      logins.push({
        userId,
        loginDate:   parseDate(r["LoginDate"]),
        loginTime:   normalizeTime(r["LoginTime"]),
        logoutDate:  parseDate(r["LogoutDate"]),
        logoutTime:  normalizeTime(r["LogoutTime"]),
        sessionTime: normalizeTime(r["SessionTime"]),
      });
    }
  }

  const videos: RawVideo[] = [];
  if (videoSheet) {
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[videoSheet], {
      defval: null,
      raw: false,
    });
    for (const r of rows) {
      const userId = upsertUser(r);
      if (!userId) continue;
      videos.push({
        userId,
        course:            nullIfEmpty(r["Course"]),
        subject:           nullIfEmpty(r["Subject"]),
        chapter:           nullIfEmpty(r["Chapter"]),
        contentName:       nullIfEmpty(r["ContentName"]),
        contentType:       nullIfEmpty(r["ContentType"]),
        totalViewDuration: normalizeTime(r["TotalViewDuration"]),
        totalViewCount:    toInt(r["TotalViewCount"], 0),
        lastAccessDate:    parseDate(r["LastAccessDate"]),
        lastAccessTime:    normalizeTime(r["LastAccessTime"]),
      });
    }
  }

  const mcq: RawMcq[] = [];
  if (mcqSheet) {
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[mcqSheet], {
      defval: null,
      raw: false,
    });
    for (const r of rows) {
      const userId = upsertUser(r);
      if (!userId) continue;
      mcq.push({
        userId,
        course:             nullIfEmpty(r["Course"]),
        subject:            nullIfEmpty(r["Subject"]),
        chapter:            nullIfEmpty(r["Chapter"]),
        totalQuestion:      toInt(r["TotalQuestion"], 0),
        rightQuestionCount: toInt(r["RightQuestionCount"], 0),
        totalMarks:         toInt(r["TotalMarks"], 0),
        marksObtained:      toInt(r["MarksObtained"], 0),
        percentage:         toFloat(r["Percentage"], 0),
        attemptedDate:      parseDate(r["AttemptedDate"]),
        attemptedTime:      normalizeTime(r["AttemptedTime"]),
        timeSpent:          normalizeTime(r["TimeSpent"]),
      });
    }
  }

  return {
    users: [...userMap.values()],
    logins,
    videos,
    mcq,
  };
}

function refreshSheetRef(sheet: xlsx.WorkSheet): void {
  let maxR = 0;
  let maxC = 0;
  for (const k of Object.keys(sheet)) {
    if (k.startsWith("!")) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(k);
    if (!m) continue;
    const row = Number(m[2]);
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    if (row > maxR) maxR = row;
    if (col > maxC) maxC = col;
  }
  if (maxR === 0) return;
  sheet["!ref"] = xlsx.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxR - 1, c: maxC - 1 },
  });
}

function parseUserKind(v: unknown): "Student" | "Teacher" | null {
  const s = nullIfEmpty(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("stud")) return "Student";
  if (lower.startsWith("teach")) return "Teacher";
  return null;
}
