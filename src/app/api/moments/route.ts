import "server-only";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

/** Serves evals/moments_<user>.json written by scripts/find_moments.ts (dev/labeling only). */
export async function GET(req: Request) {
  const user = (new URL(req.url).searchParams.get("user") ?? "sunnwy").toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(user)) {
    return NextResponse.json({ error: "Bad user" }, { status: 400 });
  }
  try {
    const raw = await readFile(`evals/moments_${user}.json`, "utf8");
    return new NextResponse(raw, { headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json(
      { error: `No moments file for ${user}. Run: npm run find-moments -- ${user}` },
      { status: 404 },
    );
  }
}
