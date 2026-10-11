/**
 * Response interceptor: a 403 never refreshes the token or logs out (and notifies listeners with
 * the organization id); a 401 still refreshes once and retries. Requests never leave the process:
 * a fake axios adapter answers them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

const auth = {
  accessToken: "old-token" as string | null,
  refreshToken: "refresh" as string | null,
  handleTokenRefresh: vi.fn(async () => {
    auth.accessToken = "new-token";
  }),
  logout: vi.fn(async () => {}),
  _clearTokens: vi.fn(),
};

vi.mock("@/stores/authStore", () => ({ useAuthStore: () => auth }));
const routerPush = vi.fn();
vi.mock("@/router", () => ({ default: { push: routerPush } }));

import apiService, { onForbidden, type ForbiddenInfo } from "../apiService";

const ORG = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** Answer requests from a script of statuses (one per call). */
function scriptAdapter(statuses: number[]): { adapter: AxiosAdapter; calls: InternalAxiosRequestConfig[] } {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    const response = { data: { message: `status ${status}` }, status, statusText: "", headers: {}, config } as AxiosResponse;
    if (status >= 400) throw new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", config, {}, response);
    return response;
  };
  return { adapter, calls };
}

const originalAdapter = apiService.defaults.adapter;

beforeEach(() => {
  auth.accessToken = "old-token";
  auth.refreshToken = "refresh";
  vi.clearAllMocks();
});

afterEach(() => {
  apiService.defaults.adapter = originalAdapter;
});

describe("403 Forbidden", () => {
  it("never calls handleTokenRefresh, never logs out, never redirects", async () => {
    const { adapter, calls } = scriptAdapter([403]);
    apiService.defaults.adapter = adapter;

    await expect(apiService.get(`/organizations/${ORG}/analytics`)).rejects.toMatchObject({ response: { status: 403 } });
    expect(calls).toHaveLength(1); // no retry
    expect(auth.handleTokenRefresh).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(auth._clearTokens).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("tells listeners which organization refused (to refresh the membership)", async () => {
    const { adapter } = scriptAdapter([403]);
    apiService.defaults.adapter = adapter;
    const seen: ForbiddenInfo[] = [];
    const stop = onForbidden((info) => seen.push(info));

    await apiService.put(`/organizations/${ORG}/tasks/abc`, {}).catch(() => {});
    await apiService.get("/tasks").catch(() => {});
    stop();
    await apiService.get(`/organizations/${ORG}`).catch(() => {});

    expect(seen.map((s) => s.organizationId)).toEqual([ORG, null]);
  });
});

describe("401 Unauthorized (unchanged)", () => {
  it("refreshes the token once and retries with the new one", async () => {
    const { adapter, calls } = scriptAdapter([401, 200]);
    apiService.defaults.adapter = adapter;

    const result = await apiService.get("/tasks");
    expect(result.status).toBe(200);
    expect(auth.handleTokenRefresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(String(calls[1]!.headers.Authorization)).toBe("Bearer new-token");
  });
});
