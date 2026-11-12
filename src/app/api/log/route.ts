import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isLogEvent } from "@/lib/log";

const LOG_DIR = "logs";
const LOG_FILE = `${LOG_DIR}/interactions.jsonl`;

/** Appends one interaction row (see src/lib/log.ts) to logs/interactions.jsonl. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!isLogEvent(body)) {
    return NextResponse.json({ error: "Bad event (need ts, sessionId, mode)" }, { status: 400 });
  }
  // Vercel's filesystem is read-only: print the row to the function logs instead.
  if (process.env.VERCEL) {
    console.log("[interaction]", JSON.stringify(body));
    return new NextResponse(null, { status: 204 });
  }
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify(body) + "\n", "utf8");
  return new NextResponse(null, { status: 204 });
}
