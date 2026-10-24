// src/services/authService.ts — the /auth endpoints.

import { isCancel } from "axios";
import apiService from "./apiService";
import { httpStatus } from "@/lib/apiErrors";
import type { AuthResponse } from "@/types";
import type {
  RegisterRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResendConfirmationRequest,
} from "@/types/auth";

// Login a user and get tokens
async function login(credentials: LoginRequest): Promise<AuthResponse> {
  const response = await apiService.post<AuthResponse>(
    "/auth/login",
    credentials
  );
  return response.data;
}

// Register a new user, potentially with guest data to migrate
async function register(userData: RegisterRequest): Promise<void> {
  // The register endpoint returns a 200 OK with a message, not tokens, so the promise is void.
  await apiService.post("/auth/register", userData);
}

/**
 * How long a token refresh may take. Without a limit, a refresh the server never answers would
 * hang every request waiting for it. Longer than a cold start (~20–40 s): a refresh the server
 * is still going to process should not be abandoned (its rotated token would be lost). A timeout
 * is transient: the session is kept and the next request tries again.
 */
export const REFRESH_TIMEOUT_MS = 45_000;
/** Per attempt of the background logout (the server may be cold). */
export const REVOKE_TIMEOUT_MS = 60_000;
/** Waits before retrying a background logout that failed with a network error or 5xx. */
export const REVOKE_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];

/**
 * Exchange a refresh token for new tokens. Session-independent: it is never aborted when the user
 * logs out meanwhile, so the auth store learns the rotated refresh token and can revoke it.
 * Rejects with the original axios error (its status tells a refused token from a cold server).
 */
async function refresh(refreshToken: string): Promise<AuthResponse> {
  const response = await apiService.post<AuthResponse>(
    "/auth/refresh",
    { refreshToken },
    { sessionIndependent: true, timeout: REFRESH_TIMEOUT_MS }
  );
  return response.data;
}

/**
 * Invalidate a refresh token on the server (POST /auth/logout { refreshToken } → 204). Works
 * without a valid access token, and deliberately sends none: an access token would make the
 * server revoke the CURRENT session of that user, which may be a newer one.
 */
async function logout(refreshToken: string): Promise<void> {
  await apiService.post("/auth/logout", { refreshToken }, { sessionIndependent: true, timeout: REVOKE_TIMEOUT_MS });
}

/** Worth retrying: no answer (network, timeout) or a server error. Never a 4xx. */
function isRetriableRevokeError(error: unknown): boolean {
  if (isCancel(error)) return false;
  const status = httpStatus(error);
  return status === null || status >= 500;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Revoke `refreshToken`, retrying network errors and 5xx after each of `delays` (never a 4xx).
 * Resolves true when the server answered 2xx; never rejects.
 */
export async function revokeWithRetry(
  refreshToken: string,
  delays: readonly number[] = REVOKE_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep
): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await logout(refreshToken);
      return true;
    } catch (error) {
      if (!isRetriableRevokeError(error) || attempt >= delays.length) {
        console.warn("Could not revoke the refresh token on the server (it expires on its own):", error);
        return false;
      }
      await wait(delays[attempt]!);
    }
  }
}

/**
 * Background logout: revoke `refreshToken` without waiting (a cold server may take a while),
 * retried a couple of times on network errors / 5xx. Never throws.
 */
function revokeRefreshToken(refreshToken: string): void {
  void revokeWithRetry(refreshToken);
}

// ADDED: Function to confirm a user's email
async function confirmEmail(userId: string, token: string): Promise<void> {
  // This is a GET request with query parameters.
  await apiService.get("/auth/confirm-email", {
    params: { userId, token },
  });
}

async function resendConfirmationEmail(
  data: ResendConfirmationRequest
): Promise<void> {
  await apiService.post("/auth/resend-confirmation-email", data);
}

async function forgotPassword(data: ForgotPasswordRequest): Promise<void> {
  await apiService.post("/auth/forgot-password", data);
}

// --- ADDED: Function to submit the new password and token ---
async function resetPassword(data: ResetPasswordRequest): Promise<void> {
  await apiService.post("/auth/reset-password", data);
}

// We will add functions for refresh, forgot password, etc., later as needed.

// Export the functions as part of a service object
export const authService = {
  login,
  register,
  logout,
  revokeRefreshToken,
  refresh,
  confirmEmail,
  forgotPassword,
  resetPassword,
  resendConfirmationEmail,
};
