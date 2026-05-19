import { z } from "zod";

// Multi-value filters arrive as either a single string (?schools=A) or a
// repeated param array (?schools=A&schools=B). We DO NOT split on commas —
// some school/course names contain commas (e.g. "Jilha Parishad Prathamik
// Shala, Nandanmal"), and a CSV split would shred them into non-matching
// halves and return empty results. Clients that need multiple values must
// use the repeated-param form.
const CsvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [];
    const raw = Array.isArray(v) ? v : [v];
    return raw.map((s) => s.trim()).filter(Boolean);
  });

const YearOrAll = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "all" || v === "" ? "all" : Number(v)))
  .pipe(z.union([z.literal("all"), z.number().int().min(2000).max(2100)]));

const MonthOrAll = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "all" || v === "" ? "all" : Number(v)))
  .pipe(z.union([z.literal("all"), z.number().int().min(1).max(12)]));

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .optional();

export const FilterQuerySchema = z.object({
  year: YearOrAll.default("all"),
  month: MonthOrAll.default("all"),
  schools: CsvList,
  courses: CsvList,
  divisions: CsvList,
  genders: CsvList,
  dateFrom: DateString,
  dateTo: DateString,
});

export type FilterQuery = z.infer<typeof FilterQuerySchema>;

export interface ClauseOptions {
  dateColumn: string;          // e.g. "lh.login_date" or "vu.last_access_date"
  schoolColumn?: string;       // e.g. "u.school"
  courseColumn?: string;       // e.g. "vu.course" — omit for tables without course
  divisionColumn?: string;     // e.g. "u.division"
  genderColumn?: string;       // e.g. "u.gender"
}

export interface BuiltClause {
  where: string;          // " WHERE ... " (empty string if no filters)
  params: unknown[];      // positional params for mysql2
}

/**
 * Builds the WHERE clause + parameter list for a filtered query.
 * Skips any filter whose column was not provided in opts (e.g. login_history has no course).
 */
export function buildWhereClause(f: FilterQuery, opts: ClauseOptions): BuiltClause {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (f.dateFrom && f.dateTo) {
    parts.push(`${opts.dateColumn} BETWEEN ? AND ?`);
    params.push(f.dateFrom, f.dateTo);
  } else if (f.dateFrom) {
    parts.push(`${opts.dateColumn} >= ?`);
    params.push(f.dateFrom);
  } else if (f.dateTo) {
    parts.push(`${opts.dateColumn} <= ?`);
    params.push(f.dateTo);
  } else {
    if (f.year !== "all") {
      parts.push(`YEAR(${opts.dateColumn}) = ?`);
      params.push(f.year);
    }
    if (f.month !== "all") {
      parts.push(`MONTH(${opts.dateColumn}) = ?`);
      params.push(f.month);
    }
  }

  if (opts.schoolColumn && f.schools.length > 0) {
    parts.push(`${opts.schoolColumn} IN (${f.schools.map(() => "?").join(",")})`);
    params.push(...f.schools);
  }
  if (opts.courseColumn && f.courses.length > 0) {
    parts.push(`${opts.courseColumn} IN (${f.courses.map(() => "?").join(",")})`);
    params.push(...f.courses);
  }
  if (opts.divisionColumn && f.divisions.length > 0) {
    parts.push(`${opts.divisionColumn} IN (${f.divisions.map(() => "?").join(",")})`);
    params.push(...f.divisions);
  }
  if (opts.genderColumn && f.genders.length > 0) {
    parts.push(`${opts.genderColumn} IN (${f.genders.map(() => "?").join(",")})`);
    params.push(...f.genders);
  }

  return {
    where: parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}
