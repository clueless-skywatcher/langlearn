#!/usr/bin/env -S npx tsx
/**
 * Projects `content/schema.ts` into JSON Schema, so that an editor can offer
 * completion and inline validation while a pack is being written by hand.
 * `.vscode/settings.json` maps the two files onto the content globs.
 *
 * The output is derived, not authored: with `--check` the script reports a
 * stale file rather than writing one, which is how `yarn check` keeps the
 * committed schema honest.
 *
 * Draft 7 is the target because that is what editors implement fully. Zod's
 * refinements have no JSON Schema equivalent and are dropped here; so is every
 * rule in `content/validate.ts`. The editor checks shape, `yarn
 * validate:content` checks the course.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { Course, Section } from "../content/schema";

const OUTPUTS = [
  ["content/course.schema.json", Course],
  ["content/section.schema.json", Section],
] as const;

function render(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
  });
  return JSON.stringify(json, null, 2) + "\n";
}

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const [file, schema] of OUTPUTS) {
  const target = path.join(process.cwd(), file);
  const next = render(schema);

  if (check) {
    const current = fs.existsSync(target)
      ? fs.readFileSync(target, "utf8")
      : null;
    if (current !== next) stale.push(file);
    continue;
  }

  fs.writeFileSync(target, next);
  console.log(`wrote ${file}`);
}

if (stale.length) {
  console.error(
    `\n${stale.length} generated schema(s) out of date:\n` +
      stale.map((f) => `  ${f}`).join("\n") +
      "\n\nrun: yarn generate:schema\n",
  );
  process.exit(1);
}

if (check) console.log("generated schemas up to date");
