/**
 * Re-renders reports/latest.html from data/latest.json without refetching.
 *
 *   npm run report
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./config.ts";
import { renderReport } from "./report/template.ts";
import type { Snapshot } from "./snapshotTypes.ts";

const snapshot = JSON.parse(await readFile(path.join(PROJECT_ROOT, "data", "latest.json"), "utf8")) as Snapshot;
await mkdir(path.join(PROJECT_ROOT, "reports"), { recursive: true });
await writeFile(path.join(PROJECT_ROOT, "reports", "latest.html"), renderReport(snapshot));
console.log("Wrote reports/latest.html");
