import { NextResponse } from "next/server";
import { fetchRecentGames, fetchStats, UnknownUserError } from "@/lib/chesscom";

export async function GET(req: Request) {
  const user = new URL(req.url).searchParams.get("user")?.trim();
  if (!user) {
    return NextResponse.json({ error: "Missing ?user=" }, { status: 400 });
  }
  try {
    const [games, stats] = await Promise.all([fetchRecentGames(user), fetchStats(user)]);
    return NextResponse.json({ games, stats });
  } catch (err) {
    if (err instanceof UnknownUserError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
