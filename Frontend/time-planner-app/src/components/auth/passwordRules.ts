// src/components/auth/passwordRules.ts — mirrors the backend Identity password policy
// (TimePlanner.API/Program.cs: RequiredLength 8, RequireUppercase, RequireLowercase,
// RequireDigit, RequireNonAlphanumeric). Identity uses Unicode-aware char checks, so do we.

export interface PasswordRule {
  id: "length" | "upper" | "lower" | "digit" | "symbol";
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", label: "At least 8 characters", test: (pw) => pw.length >= 8 /* UTF-16 length, like .NET */ },
  { id: "upper", label: "One uppercase letter", test: (pw) => /\p{Lu}/u.test(pw) },
  { id: "lower", label: "One lowercase letter", test: (pw) => /\p{Ll}/u.test(pw) },
  { id: "digit", label: "One number", test: (pw) => /\p{Nd}/u.test(pw) },
  // .NET IsLetterOrDigit = letters + decimal digits; everything else (incl. spaces) is a "symbol".
  { id: "symbol", label: "One symbol", test: (pw) => /[^\p{L}\p{Nd}]/u.test(pw) },
];

/** True when `password` satisfies every backend rule. */
export function meetsPasswordRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
