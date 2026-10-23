// NEW FILE: src/stores/authStore.ts

import { defineStore } from "pinia";
import { authService } from "@/services/authService";
import { useUIStore } from "./uiStore";
import type {
  LoginRequest,
  RegisterRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResendConfirmationRequest,
} from "@/types/auth";

// Define the shape of our authentication state
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  status: "guest" | "loggedIn" | "loading" | "error";
  registeredEmail: string | null;
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    // Initialize tokens from localStorage to keep the user logged in across sessions
    accessToken: localStorage.getItem("accessToken") || null,
    refreshToken: localStorage.getItem("refreshToken") || null,
    status: localStorage.getItem("accessToken") ? "loggedIn" : "guest",
    registeredEmail: null as string | null,
  }),

  getters: {
    // A reactive getter to easily check if the user is authenticated
    isAuthenticated: (state) => !!state.accessToken,
    // A getter to expose the current auth status
    authStatus: (state) => state.status,
  },

  actions: {
    // Central action to handle successful authentication
    _setTokens(accessToken: string, refreshToken: string) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.status = "loggedIn";
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
    },

    // Central action to handle logout or session clearing
    _clearTokens() {
      this.accessToken = null;
      this.refreshToken = null;
      this.status = "guest";
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    },

    // --- ADDED: The core token refresh action ---
    async handleTokenRefresh() {
      // 1. Ensure we have a refresh token to begin with.
      if (!this.refreshToken) {
        throw new Error("No refresh token available.");
      }

      try {
        // 2. Call the service to get new tokens.
        const { accessToken, refreshToken } = await authService.refresh(
          this.refreshToken
        );

        // 3. If successful, update the state with the new tokens.
        this._setTokens(accessToken, refreshToken);
        console.log("Token refreshed successfully.");
      } catch (error) {
        // 4. If refreshing fails (e.g., refresh token is expired or invalid)...
        console.error("Failed to refresh token:", error);

        // ...trigger a full logout. This will clear all local data.
        this._clearTokens(); 
        // 5. Throw the error so the interceptor knows the refresh failed.
        throw new Error("Session expired. Please log in again.");
      }
    },

    // Action to log in a user
    async login(credentials: LoginRequest) {
      this.status = "loading";
      const uiStore = useUIStore();
      try {
        const { accessToken, refreshToken } = await authService.login(
          credentials
        );
        this._setTokens(accessToken, refreshToken);
        // We will trigger the taskStore to reload data in a later step.
        return true;
      } catch (error) {
        this.status = "error";
        uiStore.showToast(
          "Login failed. Please check your credentials.",
          "error"
        );
        console.error("Login error:", error);
        return false;
      }
    },

    // Action to register a user
    async register(userData: RegisterRequest) {
      this.status = "loading";
      const uiStore = useUIStore();
      try {
        await authService.register(userData);
        this.status = "guest"; // User is not logged in after registration
        this.registeredEmail = userData.email;
        // We will trigger the taskStore to clear local data in a later step if migration occurred.
        return true;
      } catch (error: any) {
        this.status = "error";
        const message =
          error.response?.status === 409
            ? "A user with this email already exists."
            : "Registration failed. Please try again.";
        uiStore.showToast(message, "error");
        console.error("Registration error:", error);
        return false;
      }
    },

    async handleResendConfirmation() {
      if (!this.registeredEmail) {
        useUIStore().showToast(
          "No email found to resend confirmation.",
          "error"
        );
        return;
      }
      this.status = "loading";
      try {
        await authService.resendConfirmationEmail({
          email: this.registeredEmail,
        });
        useUIStore().showToast(
          "A new confirmation email has been sent.",
          "success"
        );
        this.status = "guest";
      } catch (error) {
        console.error("Resend confirmation error:", error);
        useUIStore().showToast("An error occurred. Please try again.", "error");
        this.status = "error";
      }
    },

    // Action to log out a user
    async logout() {
      const uiStore = useUIStore();
      try {
        // Only call the backend if the user was considered logged in.
        // We check refreshToken here because accessToken might be null but a session could exist.
        if (this.refreshToken) {
          await authService.logout();
        }
      } catch (error) {
        // Ignore API errors during logout (e.g., 401 or Network Error).
        // We are logging out anyway.
      console.warn("Logout API call failed, but clearing local session anyway.");
      } finally {
        this._clearTokens();
        // We will no longer show a toast on programmatic logout to avoid annoying the user.
      }
    },
    async handleForgotPassword(data: ForgotPasswordRequest): Promise<boolean> {
      this.status = "loading";
      const uiStore = useUIStore();
      try {
        await authService.forgotPassword(data);
        // Backend always returns success to prevent email enumeration, so we do the same.
        uiStore.showToast(
          "If an account exists, a password reset link has been sent.",
          "success"
        );
        this.status = "guest";
        return true;
      } catch (error) {
        // This catch block might not even be hit if the backend is configured correctly,
        // but it's good practice to have it.
        console.error("Forgot password error:", error);
        uiStore.showToast(
          "An unexpected error occurred. Please try again.",
          "error"
        );
        this.status = "error";
        return false;
      }
    },

    // --- ADDED: Action to handle the final password reset ---
    async handleResetPassword(data: ResetPasswordRequest): Promise<boolean> {
      this.status = "loading";
      const uiStore = useUIStore();
      try {
        await authService.resetPassword(data);
        uiStore.showToast(
          "Password reset successfully! You can now log in.",
          "success"
        );
        this.status = "guest";
        return true;
      } catch (error: any) {
        const message =
          error.response?.data?.message ||
          "Password reset failed. The link may be invalid or expired.";
        uiStore.showToast(message, "error");
        this.status = "error";
        return false;
      }
    },
  },
});
