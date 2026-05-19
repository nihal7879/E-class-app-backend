/**
 * Future source: senior sir's API.
 *
 * When the real endpoint is ready, implement readFromApi() so it returns the
 * same IngestBatch shape as readExcel(). The loader does not need to change.
 *
 * Typical sketch:
 *   const res = await fetch(env.SENIOR_API_URL, { headers: { Authorization: ... } });
 *   const json = await res.json();
 *   return mapResponseToBatch(json);
 */
import type { IngestBatch } from "../types.js";

export async function readFromApi(_opts: { url: string; token?: string }): Promise<IngestBatch> {
  throw new Error(
    "readFromApi() not yet implemented — waiting for senior sir's API spec. Use the Excel source for now.",
  );
}
