/**
 * Ingest CLI — drives both flows:
 *
 *   Flow 1 (primary, when senior's API is ready):
 *     npm run ingest -- --source=api
 *
 *   Flow 2 (fallback, manual Excel upload):
 *     npm run ingest -- --source=excel --file="path/to/report.xlsx"
 *
 * Common options:
 *     --mode=append    (default) keep existing rows; UPSERT users, INSERT logins/videos/mcq.
 *                      Right for monthly increments (Jan stays when you load Feb).
 *     --mode=replace   wipe all four tables, then INSERT fresh from this batch.
 *
 * Examples:
 *     npm run ingest:excel -- --file="C:/Users/dell/Downloads/OverallActivityReport_20260514_145352.xlsx"
 *     npm run ingest:api
 */

import "dotenv/config";
import { readExcel } from "./sources/excel.js";
import { readFromApi } from "./sources/api.js";
import { loadBatch, type IngestMode } from "./loader.js";
import { pool } from "../db.js";

interface Args {
  source: "excel" | "api";
  file?: string;
  mode: IngestMode;
}

function parseArgs(): Args {
  const out: Args = { source: "excel", mode: "append" };
  for (const arg of process.argv.slice(2)) {
    const eq = arg.indexOf("=");
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    const val = eq >= 0 ? arg.slice(eq + 1) : "";
    switch (key) {
      case "--source":
        if (val !== "excel" && val !== "api") {
          throw new Error(`--source must be 'excel' or 'api', got: ${val}`);
        }
        out.source = val;
        break;
      case "--file":
        out.file = val;
        break;
      case "--mode":
        if (val !== "replace" && val !== "append") {
          throw new Error(`--mode must be 'replace' or 'append', got: ${val}`);
        }
        out.mode = val;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[ingest] source=${args.source} mode=${args.mode}${args.file ? ` file=${args.file}` : ""}`);

  let batch;
  if (args.source === "excel") {
    if (!args.file) {
      throw new Error("--source=excel requires --file=<path-to-xlsx>");
    }
    console.log("[ingest] reading Excel...");
    batch = readExcel(args.file);
  } else {
    const url = process.env.SENIOR_API_URL;
    const token = process.env.SENIOR_API_TOKEN;
    if (!url) {
      throw new Error("--source=api requires SENIOR_API_URL in .env");
    }
    console.log("[ingest] fetching API...");
    batch = await readFromApi({ url, token });
  }

  console.log(
    `[ingest] parsed: ${batch.users.length} users, ` +
      `${batch.logins.length} logins, ${batch.videos.length} videos, ${batch.mcq.length} mcq`,
  );

  if (batch.users.length === 0 && batch.logins.length === 0 && batch.videos.length === 0 && batch.mcq.length === 0) {
    console.log("[ingest] nothing to load — exiting without touching DB");
    return;
  }

  console.log("[ingest] writing to MySQL...");
  const result = await loadBatch(batch, args.mode);
  console.log("[ingest] done:", result);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[ingest] FAILED:", err instanceof Error ? err.message : err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
