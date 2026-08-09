import { findCourse } from "@/content/loader";
import { SERVER_PERSISTS } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-held progress. Only meaningful when this build uses the SQLite store;
 * with the browser store the learner's progress never leaves their machine and
 * there is nothing here to serve.
 */
function unavailable() {
  return Response.json(
    {
      error:
        "this build stores progress in the browser; there is no server-side progress to read",
    },
    { status: 501 },
  );
}

function course(request: Request): string | null {
  return new URL(request.url).searchParams.get("courseId");
}

export async function GET(request: Request) {
  if (!SERVER_PERSISTS) return unavailable();

  const courseId = course(request);
  if (!courseId) {
    return Response.json({ error: "courseId is required" }, { status: 400 });
  }
  if (!findCourse(courseId)) {
    return Response.json({ error: `no such course: ${courseId}` }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const { sqliteStore } = await import("@/lib/progress/sqlite");

  if (params.get("mistakes")) {
    const limit = Number(params.get("limit") ?? 100);
    return Response.json({
      courseId,
      mistakes: await sqliteStore.mistakes(
        courseId,
        Number.isFinite(limit) ? limit : 100,
      ),
    });
  }

  return Response.json({
    courseId,
    progress: await sqliteStore.progress(courseId),
  });
}

export async function DELETE(request: Request) {
  if (!SERVER_PERSISTS) return unavailable();

  const courseId = course(request);
  if (courseId && !findCourse(courseId)) {
    return Response.json({ error: `no such course: ${courseId}` }, { status: 404 });
  }

  const { sqliteStore } = await import("@/lib/progress/sqlite");
  await sqliteStore.clear(courseId ?? undefined);
  return Response.json({ cleared: courseId ?? "all" });
}
