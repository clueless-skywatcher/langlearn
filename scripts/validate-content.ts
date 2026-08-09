#!/usr/bin/env -S npx tsx
import { listCourseIds } from "../content/loader";
import { validateAll, type Problem } from "../content/validate";

const ids = process.argv.slice(2);
const courses = ids.length ? ids : listCourseIds();

if (courses.length === 0) {
  console.error("no course packs found under content/");
  process.exit(1);
}

const problems = validateAll(courses);
const errors = problems.filter((p) => p.severity === "error");
const warnings = problems.filter((p) => p.severity === "warning");

function print(list: Problem[], label: string): void {
  for (const p of list) {
    console.error(`  ${label} ${p.where}: ${p.message}`);
  }
}

if (warnings.length) {
  console.error(`\n${warnings.length} warning(s):`);
  print(warnings, "warn");
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  print(errors, "error");
  console.error("");
  process.exit(1);
}

console.log(
  `content ok — ${courses.length} course pack(s) validated${
    warnings.length ? `, ${warnings.length} warning(s)` : ""
  }`,
);
