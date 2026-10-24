// src/lib/joinCode.ts — organization join codes as people type them.
//
// Codes are 8 characters (letters and digits). People paste them with spaces or dashes
// ("abcd-1234", "ABCD 1234") or in lower case; the API wants the bare upper-case code.

export const JOIN_CODE_LENGTH = 8;

/** "abcd-12 34" → "ABCD1234": upper case, whitespace and dashes (incl. Unicode dashes) removed. */
export function normalizeJoinCode(input: string): string {
  return input.replace(/[\s\-‐-―−]+/g, "").toUpperCase();
}

/** Whether `input` normalizes to a complete code (8 letters/digits). */
export function isCompleteJoinCode(input: string): boolean {
  return new RegExp(`^[A-Z0-9]{${JOIN_CODE_LENGTH}}$`).test(normalizeJoinCode(input));
}
