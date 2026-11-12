import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/ratelimit";

describe("checkRateLimit", () => {
  it("allows 60 calls per IP per window, then refuses until the window resets", () => {
    const t = 1_000_000;
    for (let i = 0; i < 60; i++) expect(checkRateLimit("1.1.1.1", t).ok).toBe(true);
    const r = checkRateLimit("1.1.1.1", t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.scope).toBe("ip");
    expect(checkRateLimit("2.2.2.2", t).ok).toBe(true);
    expect(checkRateLimit("1.1.1.1", t + 10 * 60_000).ok).toBe(true);
  });
});
