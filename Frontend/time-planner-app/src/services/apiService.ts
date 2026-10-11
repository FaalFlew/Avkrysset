// NEW FILE: src/services/apiService.ts

import axios from "axios";
import { useAuthStore } from "@/stores/authStore";
import router from "@/router";

// 1. Create a new axios instance with a custom configuration
const apiService = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// --- CONCURRENCY & LOCKING MECHANISM ---
// This flag prevents multiple refresh requests from happening at the same time.
let isRefreshing = false;
// This queue holds requests that failed while the token was being refreshed.
let failedQueue: any[] = [];

// Helper function to process the queue once the token is refreshed or fails
const processQueue = (error: any, token: string | null = null) => {
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

// 2. Add a request interceptor to attach the JWT token
apiService.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    const token = authStore.accessToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 3. The response interceptor handles token refreshing and queueing
apiService.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // --- CRITICAL LOOP BREAKER ---
    // If the error comes from the refresh endpoint or logout endpoint, DO NOT retry.
    // This stops the infinite loop/stack overflow.
    if (
      originalRequest.url.includes("/auth/refresh") ||
      originalRequest.url.includes("/auth/logout")
    ) {
      return Promise.reject(error);
    }

    const authStore = useAuthStore();

    // Check for 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      
      // If we don't have a refresh token, we can't do anything. Logout.
      if (!authStore.refreshToken) {
        await authStore.logout();
        router.push("/login");
        return Promise.reject(error);
      }

      // --- CONCURRENCY CHECK ---
      // If a refresh is already in progress, add this request to the queue
      // and wait for the first request to finish refreshing the token.
      if (isRefreshing) {
        return new Promise(function (resolve, reject) {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            // Once resolved, update the header with the NEW token and retry
            originalRequest.headers["Authorization"] = "Bearer " + token;
            return apiService(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      // If we are here, we are the first request to fail. Start the refresh process.
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        console.log("Access token expired. Attempting to refresh...");
        
        // Call the store action to get new tokens
        await authStore.handleTokenRefresh();
        
        // Get the new token from the store
        const newToken = authStore.accessToken;

        console.log("Token refreshed. Retrying original request and processing queue.");
        
        // 1. Process the queue: tell all waiting requests to proceed with the new token
        processQueue(null, newToken);

        // 2. Retry the specific request that started this whole process
        // Note: The request interceptor will automatically attach the new token from the store,
        // but explicit assignment here is safer for the retry.
        originalRequest.headers["Authorization"] = "Bearer " + newToken;
        return apiService(originalRequest);

      } catch (refreshError) {
        // If the refresh fails (e.g. refresh token expired on server):
        
        // 1. Fail all queued requests
        processQueue(refreshError, null);

        // 2. Log out the user locally
        // We use _clearTokens directly or a lightweight logout to avoid hitting the API again
        // since we know the session is dead.
        authStore._clearTokens(); 
        
        router.push({
          path: "/login",
          query: { sessionExpired: "true" },
        });

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