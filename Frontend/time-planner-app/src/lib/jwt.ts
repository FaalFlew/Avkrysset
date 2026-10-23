// src/lib/jwt.ts — reading claims of the API's JWT access tokens (no library, no signature check:
// the server verifies tokens; the client only peeks at the user id and the expiry).

/** The payload claims of a JWT, or null when the token can't be read. */
export function jwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** When the token expires (epoch ms, from the `exp` claim in seconds), or null when unknown. */
export function jwtExpiresAt(token: string | null | undefined): number | null {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

/**
 * Whether the token has expired at `atMs` (epoch ms). A token without a readable `exp` counts as
 * not expired: the server decides (a 401 still triggers the normal refresh).
 */
export function isJwtExpired(token: string | null | undefined, atMs: number): boolean {
  const expiresAt = jwtExpiresAt(token);
  return expiresAt !== null && expiresAt <= atMs;
}
