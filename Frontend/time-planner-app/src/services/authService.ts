// NEW FILE: src/services/authService.ts

import apiService from "./apiService";
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

async function refresh(refreshToken: string): Promise<AuthResponse> {
  const response = await apiService.post<AuthResponse>("/auth/refresh", {
    refreshToken,
  });
  return response.data;
}

// Logout the user by invalidating the refresh token on the server
async function logout(): Promise<void> {
  // The logout endpoint requires authentication, which our apiService interceptor handles automatically.
  await apiService.post("/auth/logout");
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
  refresh,
  confirmEmail,
  forgotPassword,
  resetPassword,
  resendConfirmationEmail,
};
