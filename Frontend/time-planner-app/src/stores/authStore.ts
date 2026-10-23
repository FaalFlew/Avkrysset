// src/stores/authStore.ts — tokens, auth status and the session epoch.
//
// Session epoch (docs/plans/auth-session-race.md): a counter bumped whenever a session starts
// (login) or ends (logout, session clear). apiService stamps every request with it and rejects
// answers of an older epoch with SessionChangedError; store actions wrap their awaits in
// sessionBound(). A token refresh keeps the epoch (same session, new tokens).

import { defineStore } from "pinia";
import { authService } from "@/services/authService";
import { abortSessionRequests } from "@/services/apiService";
import { isSessionChangedError, SessionChangedError } from "@/lib/apiErrors";
import { useUIStore } from "./uiStore";
import type { AuthResponse } from "@/types";
import type {
  LoginRequest,
  RegisterRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from "@/types/auth";

/** HTTP status of a failed axios request, or `null` when there was no response (network). */
function httpStatusOf(error: unknown): number | null {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === "number" ? status : null;
}

// Define the shape of our authentication state
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  status: "guest" | "loggedIn" | "loading" | "error";
  registeredEmail: string | null;
  /**
   * Last login/register failure (`status` = HTTP status, `null` = no response, i.e. network).
   * Read by the auth views (components/auth/authErrors.ts) for precise inline errors.
   */
  lastError: { status: number | null } | null;
  /**
   * Bumped when a session starts (login) or ends (logout / session clear); never by a token
   * refresh. Requests and store actions compare it before touching state.
   */
  sessionEpoch: number;
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    // Initialize tokens from localStorage to keep the user logged in across sessions
    accessToken: localStorage.getItem("accessToken") || null,
    refreshToken: localStorage.getItem("refreshToken") || null,
    status: localStorage.getItem("accessToken") ? "loggedIn" : "guest",
    registeredEmail: null as string | null,
    lastError: null,
    sessionEpoch: 0,
  }),

  getters: {
    // A reactive getter to easily check if the user is authenticated
    isAuthenticated: (state) => !!state.accessToken,
    // A getter to expose the current auth status
    authStatus: (state) => state.status,
  },

  actions: {
    // Store tokens (login, or a refresh within the same session)
    _setTokens(accessToken: string, refreshToken: string) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.status = "loggedIn";
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
    },

    /** A new session begins (login): new epoch, then the tokens. */
    _startSession(accessToken: string, refreshToken: string) {
      this._advanceSession();
      this._setTokens(accessToken, refreshToken);
    },

    /** New epoch: requests of the previous session are aborted and their answers ignored. */
    _advanceSession() {
      this.sessionEpoch += 1;
      abortSessionRequests(this.sessionEpoch);
    },

    // Central action to handle logout or session clearing. Ends the session (new epoch) when there
    // was one; a guest stays in the same epoch (so guest data keeps being saved).
    _clearTokens() {
      const hadSession = !!(this.accessToken || this.refreshToken);
      this.accessToken = null;
      this.refreshToken = null;
      this.status = "guest";
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      if (hadSession) this._advanceSession();
    },

    /**
     * Exchange the refresh token for new tokens (apiService shares one call per session).
     * If the session ended while the server was answering (logout, or a new login), the new tokens
     * are discarded — never stored — the stray refresh token is revoked on the server (best effort)
     * and SessionChangedError is thrown. A failed refresh throws "Session expired"; ending the
     * session is up to the caller (the 401 handler logs out; a background refresh stays quiet).
     */
    async handleTokenRefresh() {
      // 1. Ensure we have a refresh token to begin with.
      const currentRefreshToken = this.refreshToken;
      if (!currentRefreshToken) {
        throw new Error("No refresh token available.");
      }
      const epoch = this.sessionEpoch;

      let tokens: AuthResponse;
      try {
        // 2. Call the service to get new tokens.
        tokens = await authService.refresh(currentRefreshToken);
      } catch (error) {
        if (this.sessionEpoch !== epoch) throw new SessionChangedError();
        console.error("Failed to refresh token:", error);
        // 3. Throw so the caller knows the refresh failed.
        throw new Error("Session expired. Please log in again.");
      }

      if (this.sessionEpoch !== epoch) {
        // The user logged out (or in again) while the server was waking up: these tokens belong to
        // a session that is over. Restoring them would sign the user back in.
        authService.revokeRefreshToken(tokens.refreshToken);
        throw new SessionChangedError();
      }

      // 4. Same session: store the new tokens.
      this._setTokens(tokens.accessToken, tokens.refreshToken);
    },

    // Action to log in a user
    async login(credentials: LoginRequest) {
      this.status = "loading";
      this.lastError = null;
      try {
        const { accessToken, refreshToken } = await authService.login(
          credentials
        );
        this._startSession(accessToken, refreshToken);
        return true;
      } catch (error) {
        if (isSessionChangedError(error)) {
          // Another sign-in finished first; this answer belongs to the previous state.
          this.status = this.accessToken ? "loggedIn" : "guest";
          return !!this.accessToken;
        }
        this.status = "error";
        // No toast: LoginView shows an inline error (copy chosen from `lastError`).
        this.lastError = { status: httpStatusOf(error) };
        console.error("Login error:", error);
        return false;
      }
    },

    // Action to register a user
    async register(userData: RegisterRequest) {
      this.status = "loading";
      this.lastError = null;
      try {
        await authService.register(userData);
        this.status = "guest"; // User is not logged in after registration
        this.registeredEmail = userData.email;
        return true;
      } catch (error) {
        this.status = "error";
        // No toast: RegisterView shows an inline error (copy chosen from `lastError`).
        this.lastError = { status: httpStatusOf(error) };
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

    /**
     * Log out instantly: the local session ends now (guest mode; in-flight requests of the session
     * are aborted and never retried), and the server is told in the background with the refresh
     * token being discarded — never waiting for a cold server. No toast.
     */
    async logout() {
      // We check refreshToken here because accessToken might be null but a session could exist.
      const refreshToken = this.refreshToken;
      this._clearTokens();
      if (refreshToken) authService.revokeRefreshToken(refreshToken);
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
      } catch (error) {
        const serverMessage = (error as { response?: { data?: { message?: unknown } } } | null)?.response
          ?.data?.message;
        const message =
          (typeof serverMessage === "string" && serverMessage) ||
          "Password reset failed. The link may be invalid or expired.";
        uiStore.showToast(message, "error");
        this.status = "error";
        return false;
      }
    },
  },
});

/**
 * Run an API call for the current session. If the session changes before it settles (logout, a
 * new login), its result or error is replaced by SessionChangedError, so a store never writes
 * one session's data into another. apiService guards responses too; this also covers the
 * microtasks between a response and the store's continuation (and mocked services in tests).
 */
export async function sessionBound<T>(work: () => Promise<T>): Promise<T> {
  const auth = useAuthStore();
  const epoch = auth.sessionEpoch;
  let result: T;
  try {
    result = await work();
  } catch (error) {
    if (auth.sessionEpoch !== epoch) throw new SessionChangedError();
    throw error;
  }
  if (auth.sessionEpoch !== epoch) throw new SessionChangedError();
  return result;
}
