// src/services/apiService.ts

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type * as AuthStoreModule from "@/stores/authStore";
import { getActiveTimeZone } from "@/lib/datetime";
import { organizationIdFromUrl } from "@/lib/apiErrors";

// 1. Create a new axios instance with a custom configuration
const apiService = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

/** A request config that remembers whether it was already retried after a token refresh. */
type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** A request waiting for the token refresh that another request started. */
interface QueuedRequest {
  resolve: (token: string | null) => void;
  reject: (error: unknown) => void;
}

// The router and the auth store are imported lazily. Static imports would close the cycles
// router → views → stores → services → apiService → router and
// apiService → authStore → authService → apiService, which break HMR
// ("Cannot access … before initialization"). Both modules are already loaded by the app, so the
// dynamic import only costs a microtask.

/** The Pinia auth store (tokens). */
async function getAuthStore(): Promise<ReturnType<typeof AuthStoreModule.useAuthStore>> {
  const { useAuthStore } = await import("@/stores/authStore");
  return useAuthStore();
}

/** Send the user to the login page (fire and forget, like router.push before). */
function redirectToLogin(query?: Record<string, string>): void {
  import("@/router")
    .then(({ default: router }) => router.push(query ? { path: "/login", query } : "/login"))
    .catch((error: unknown) => console.error("Could not open the login page:", error));
}

// --- 403 Forbidden ---
// A 403 means "signed in, but not allowed" (e.g. a member calling an admin endpoint, or a role
// that just changed). It must never refresh the token or log out. Listeners (the org store, once
// it exists) can re-check the membership of the organization in the URL.

export interface ForbiddenInfo {
  url: string;
  /** Organization id when the URL is `/organizations/{id}/...`. */
  organizationId: string | null;
}

const forbiddenListeners = new Set<(info: ForbiddenInfo) => void>();

/** Be told about every 403 response. Returns the unsubscribe function. */
export function onForbidden(listener: (info: ForbiddenInfo) => void): () => void {
  forbiddenListeners.add(listener);
  return () => forbiddenListeners.delete(listener);
}

function notifyForbidden(url: string): void {
  const info: ForbiddenInfo = { url, organizationId: organizationIdFromUrl(url) };
  for (const listener of forbiddenListeners) {
    try {
      listener(info);
    } catch (error) {
      console.error("403 listener failed:", error);
    }
  }
}

// --- CONCURRENCY & LOCKING MECHANISM ---
// This flag prevents multiple refresh requests from happening at the same time.
let isRefreshing = false;
// This queue holds requests that failed while the token was being refreshed.
let failedQueue: QueuedRequest[] = [];

// Helper function to process the queue once the token is refreshed or fails
const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  // Clear the queue
  failedQueue = [];
};

// 2. Add a request interceptor to attach the JWT token and the user's time zone
apiService.interceptors.request.use(
  async (config) => {
    const authStore = await getAuthStore();
    const token = authStore.accessToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // IANA zone of the device (e.g. "Europe/Oslo"). The server buckets analytics and task years
    // by this zone's calendar; without it the server falls back to UTC.
    config.headers["X-Time-Zone"] = getActiveTimeZone();

    return config;
  },
  (error: unknown) => {
    return Promise.reject(error);
  }
);

// 3. The response interceptor handles token refreshing and queueing
apiService.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;
    if (!originalRequest) return Promise.reject(error);
    const url = originalRequest.url ?? "";

    // --- CRITICAL LOOP BREAKER ---
    // If the error comes from the refresh endpoint or logout endpoint, DO NOT retry.
    // This stops the infinite loop/stack overflow.
    if (url.includes("/auth/refresh") || url.includes("/auth/logout")) {
      return Promise.reject(error);
    }

    // 403: signed in but not allowed — never refresh, never log out.
    if (error.response?.status === 403) {
      notifyForbidden(url);
      return Promise.reject(error);
    }

    const authStore = await getAuthStore();

    // Check for 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      // If we don't have a refresh token, we can't do anything. Logout.
      if (!authStore.refreshToken) {
        await authStore.logout();
        redirectToLogin();
        return Promise.reject(error);
      }

      // --- CONCURRENCY CHECK ---
      // If a refresh is already in progress, add this request to the queue
      // and wait for the first request to finish refreshing the token.
      if (isRefreshing) {
        return new Promise<string | null>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          // Once resolved, update the header with the NEW token and retry
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiService(originalRequest);
        });
      }

      // If we are here, we are the first request to fail. Start the refresh process.
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Call the store action to get new tokens
        await authStore.handleTokenRefresh();

        // Get the new token from the store
        const newToken = authStore.accessToken;

        // 1. Process the queue: tell all waiting requests to proceed with the new token
        processQueue(null, newToken);

        // 2. Retry the specific request that started this whole process
        // Note: The request interceptor will automatically attach the new token from the store,
        // but explicit assignment here is safer for the retry.
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiService(originalRequest);
      } catch (refreshError) {
        // If the refresh fails (e.g. refresh token expired on server):

        // 1. Fail all queued requests
        processQueue(refreshError, null);

        // 2. Log out the user locally
        // We use _clearTokens directly or a lightweight logout to avoid hitting the API again
        // since we know the session is dead.
        authStore._clearTokens();

        redirectToLogin({ sessionExpired: "true" });

        return Promise.reject(refreshError);
      } finally {
        // Release the lock
        isRefreshing = false;
      }
    }

    // Return any other error as is
    return Promise.reject(error);
  }
);

export default apiService;
