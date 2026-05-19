// Quick inspection: prints sheet names + first row of each sheet.
// Usage: node scripts/inspect-xlsx.mjs <path-to-xlsx>
import xlsx from "xlsx";
import { argv } from "node:process";

const file = argv[2];
if (!file) {
  console.error("Usage: node scripts/inspect-xlsx.mjs <path-to-xlsx>");
  process.exit(1);
}

const wb = xlsx.readFile(file, { cellDates: true });
console.log("File:", file);
console.log("Sheets:", wb.SheetNames);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null, raw: false });
  console.log("\n========================================");
  console.log("Sheet:", name);
  console.log("Rows:", rows.length);
  if (rows.length > 0) {
    console.log("Columns:", Object.keys(rows[0]));
    console.log("Sample row 0:", JSON.stringify(rows[0], null, 2));
    if (rows.length > 1) {
      console.log("Sample row 1:", JSON.stringify(rows[1], null, 2));
    }
  }
}
