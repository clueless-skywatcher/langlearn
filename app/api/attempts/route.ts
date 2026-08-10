import { z } from "zod";

import { findCourse, getSection } from "@/content/loader";
import { atomicQuestions, isExam } from "@/content/schema";
import { SERVER_PERSISTS, type SittingInput } from "@/lib/progress";
import { gradeDrillSet, type Response } from "@/lib/scoring";

// The content loader reads the filesystem, so this cannot run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("options"),
    selected: z.array(z.number().int().min(0).max(3)),
  }),
  z.strictObject({ kind: z.literal("integer"), value: z.number().int() }),
  z.strictObject({ kind: z.literal("skipped") }),
]);

const Body = z.strictObject({
  courseId: z.string().min(1),
  sectionId: z.string(),
  responses: z.record(z.string(), ResponseSchema),
});

/**
 * Grade one sitting.
 *
 * Grading always happens here, whichever store is in use: the rubric then has
 * exactly one implementation, and a score is one the server computed rather
 * than one the client claimed. Persistence is the part that varies — with the
 * SQLite store the sitting is written here, with the browser store the client
 * stores what this returns.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { courseId, sectionId, responses } = parsed.data;

  if (!findCourse(courseId)) {
    return Response.json({ error: `no such course: ${courseId}` }, { status: 404 });
  }

  const section = getSection(courseId, sectionId);
  if (!section) {
    return Response.json({ error: `no such section: ${sectionId}` }, { status: 404 });
  }

  const questions = atomicQuestions(section.drills);
  const known = new Set(questions.map((q) => q.id));
  const unknown = Object.keys(responses).filter((id) => !known.has(id));
  if (unknown.length) {
    return Response.json(
      { error: `not questions of ${sectionId}: ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  const result = gradeDrillSet(section, responses as Record<string, Response>);

  const sitting: SittingInput = {
    setId: crypto.randomUUID(),
    courseId,
    sectionId,
    // Both exam kinds carry a pass threshold, so both are recorded
    // as examinations for the progress rollup.
    isCheckpoint: isExam(section),
    questionTypes: Object.fromEntries(questions.map((q) => [q.id, q.type])),
    difficulties: Object.fromEntries(questions.map((q) => [q.id, q.difficulty])),
    result,
    responses: responses as Record<string, Response>,
    createdAt: new Date().toISOString(),
  };

  if (SERVER_PERSISTS) {
    // Imported here, not at the top, so a build using the browser store never
    // reaches node:sqlite.
    const { sqliteStore } = await import("@/lib/progress/sqlite");
    await sqliteStore.record(sitting);
  }

  // `responses` and `result` are echoed back in `sitting` for the browser
  // store to persist; with the SQLite store the client simply ignores them.
  return Response.json({ sitting, result, stored: SERVER_PERSISTS });
}
