#!/usr/bin/env -S npx tsx
import fs from "node:fs";

import { CONTENT_ROOT, listCourseIds } from "../content/loader";
import { validateAll, type Problem } from "../content/validate";

const args = process.argv.slice(2);
const watch = args.includes("--watch") || args.includes("-w");
const ids = args.filter((a) => !a.startsWith("-"));
const courses = ids.length ? ids : listCourseIds();

if (courses.length === 0) {
  console.error("no course packs found under content/");
  process.exit(1);
}

function print(list: Problem[], label: string): void {
  for (const p of list) {
    console.error(`  ${label} ${p.where}: ${p.message}`);
  }
}

/** One pass. Returns false if the packs have errors. */
function run(): boolean {
  const problems = validateAll(courses);
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  if (warnings.length) {
    console.error(`\n${warnings.length} warning(s):`);
    print(warnings, "warn");
  }

  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    print(errors, "error");
    console.error("");
    return false;
  }

  console.log(
    `content ok — ${courses.length} course pack(s) validated${
      warnings.length ? `, ${warnings.length} warning(s)` : ""
    }`,
  );
  return true;
}

if (!watch) {
  process.exit(run() ? 0 : 1);
}

/**
 * Watch mode re-runs on every JSON change under content/. `validateAll` reads
 * the packs from disk itself — the loader's process-wide cache is only on the
 * accessors the app uses — so a pass here always sees the current files.
 *
 * Only .json is watched: a change to schema.ts or validate.ts needs the process
 * restarted to take effect, and re-running against the code already loaded
 * would report the old rules.
 */
let timer: NodeJS.Timeout | null = null;

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    console.log(`\n— ${new Date().toLocaleTimeString()} —`);
    run();
  }, 100);
}

run();
console.log(`\nwatching ${CONTENT_ROOT} — ctrl-c to stop`);

fs.watch(CONTENT_ROOT, { recursive: true }, (_event, filename) => {
  if (filename?.endsWith(".json") && !filename.endsWith(".schema.json")) {
    schedule();
  }
});
