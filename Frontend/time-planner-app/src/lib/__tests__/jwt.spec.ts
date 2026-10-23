/** src/lib/jwt.ts: claims and expiry of access tokens, read without a library. */
import { describe, expect, it } from "vitest";
import { isJwtExpired, jwtClaims, jwtExpiresAt } from "../jwt";
import { makeJwt } from "@/services/__tests__/fakeApi";

describe("jwt", () => {
  it("reads the payload claims (base64url, UTF-8)", () => {
    const token = makeJwt({ sub: "user-ø-1", exp: 1_800_000_000, role: ["a"] });
    expect(jwtClaims(token)).toEqual({ sub: "user-ø-1", exp: 1_800_000_000, role: ["a"] });
  });

  it("returns null for anything that is not a readable JWT", () => {
    for (const token of [null, undefined, "", "abc", "a.!!!.c", `a.${Buffer.from("[1]").toString("base64url")}.c`]) {
      expect(jwtClaims(token)).toBeNull();
    }
  });

  it("exp (seconds) → epoch ms; missing or non-numeric exp → null", () => {
    expect(jwtExpiresAt(makeJwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    expect(jwtExpiresAt(makeJwt({ sub: "x" }))).toBeNull();
    expect(jwtExpiresAt(makeJwt({ exp: "soon" }))).toBeNull();
  });

  it("isJwtExpired: at or after exp; unknown expiry counts as not expired", () => {
    const token = makeJwt({ exp: 1_000 });
    expect(isJwtExpired(token, 999_999)).toBe(false);
    expect(isJwtExpired(token, 1_000_000)).toBe(true);
    expect(isJwtExpired(makeJwt({ sub: "x" }), Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(isJwtExpired(null, 0)).toBe(false);
  });
});
