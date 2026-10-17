// NEW FILE: src/types/auth.ts

import type { MigrationData } from "./index";

// Payload for the login endpoint
export interface LoginRequest {
  email: string;
  password: string;
}

// Payload for the register endpoint
export interface RegisterRequest {
  email: string;
  password: string;
  migrationData?: MigrationData;
}

export interface ForgotPasswordRequest {
  email: string;
}

// --- ADDED: Payload for the reset-password endpoint ---
export interface ResetPasswordRequest {
  userId: string;
  token: string;
  newPassword: string;
}

export interface ResendConfirmationRequest {
  email: string;
}
