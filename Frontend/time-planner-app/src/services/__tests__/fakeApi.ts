/**
 * Test helpers for the session race specs: an in-memory fake of the API behind an axios adapter
 * (nothing leaves the process), JWTs with a chosen expiry, and the browser globals the stores use.
 *
 * The fake behaves like the real server where it matters here: ONE refresh token per user,
 * rotated on every refresh; POST /auth/logout { refreshToken } revokes it without an access
 * token; authed endpoints answer 401 to unknown/expired access tokens. A "cold" server holds
 * requests until wake() — and then still processes requests the client has given up on.
 */
import {
  AxiosError,
  CanceledError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type { AuthResponse, Task } from "@/types";

export const CATEGORY = { id: "c-account", name: "Work", color: "#2F7FE0" };

/** A JWT with the given claims (unsigned: the client never verifies signatures). */
export function makeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.test-signature`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Let pending promise chains run (no timers involved, so it works under fake timers too). */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
/** An access token that expired an hour ago. */
export const expiredAccessToken = (sub = "user-1") => makeJwt({ sub, exp: nowSeconds() - 3600 });
/** An access token valid for 15 more minutes. */
export const validAccessToken = (sub = "user-1", jti = "0") => makeJwt({ sub, jti, exp: nowSeconds() + 900 });

/** localStorage (in memory) + window, as the stores expect in a browser. Returns the storage map. */
export function installBrowserGlobals(): Map<string, string> {
  const memory = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, String(value)),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
    },
  });
  (globalThis as { window?: unknown }).window ??= globalThis;
  return memory;
}

export interface ApiCall {
  /** Upper-case method, e.g. "POST". */
  method: string;
  url: string;
  body: unknown;
  /** The Authorization header as sent, or null. */
  authorization: string | null;
  config: InternalAxiosRequestConfig;
  /** The client aborted it (the server may still process it). */
  aborted: boolean;
  /** The server has processed it. */
  processed: boolean;
}

interface Answer {
  status: number;
  data?: unknown;
  /** No HTTP answer at all: a network failure (e.g. a 502 without CORS) or a client timeout. */
  fail?: "network" | "timeout";
}

/** A route answer for "no HTTP response" failures. */
export const NETWORK_FAILURE: Answer = { status: 0, fail: "network" };
export const TIMEOUT_FAILURE: Answer = { status: 0, fail: "timeout" };

function parseBody(data: unknown): unknown {
  if (typeof data !== "string") return data ?? null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export class FakeApi {
  readonly calls: ApiCall[] = [];
  /** While true, every request waits for wake() (a cold start). */
  cold = false;
  /** Hold only the matching requests until wake() (cleared by wake()). */
  hold: ((call: ApiCall) => boolean) | null = null;
  /** Like the browser's XHR adapter: an aborted request rejects with CanceledError at once. */
  honourAbort = true;
  /** Overrides, checked before the built-in routes. */
  readonly routes: Array<(call: ApiCall) => Answer | undefined> = [];

  // Server state.
  storedRefreshToken: string | null = null;
  readonly validAccessTokens = new Set<string>();
  readonly tasks: Task[] = [];

  private held: Array<() => void> = [];
  private seq = 0;

  /** Sign a user in server-side; returns the tokens (store them in the client yourself). */
  issueTokens(): AuthResponse {
    this.seq += 1;
    const accessToken = validAccessToken("user-1", String(this.seq));
    const refreshToken = `refresh-${this.seq}`;
    this.validAccessTokens.add(accessToken);
    this.storedRefreshToken = refreshToken;
    return { accessToken, refreshToken };
  }

  /** The server finishes waking up: process every held request in arrival order. */
  wake(): void {
    this.cold = false;
    this.hold = null;
    const held = this.held;
    this.held = [];
    held.forEach((run) => run());
  }

  get heldCount(): number {
    return this.held.length;
  }

  find(method: string, url: string): ApiCall[] {
    return this.calls.filter((c) => c.method === method && c.url === url);
  }

  readonly adapter: AxiosAdapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      const header = config.headers?.Authorization;
      const call: ApiCall = {
        method: (config.method ?? "get").toUpperCase(),
        url: config.url ?? "",
        body: parseBody(config.data),
        authorization: typeof header === "string" && header ? header : null,
        config,
        aborted: false,
        processed: false,
      };
      this.calls.push(call);

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const run = () => {
        call.processed = true;
        const answer = this.handle(call);
        const response = {
          data: answer.data ?? "",
          status: answer.status,
          statusText: "",
          headers: {},
          config,
        } as AxiosResponse;
        settle(() => {
          if (answer.fail === "network") reject(new AxiosError("Network Error", "ERR_NETWORK", config, {}));
          else if (answer.fail === "timeout")
            reject(new AxiosError(`timeout of ${config.timeout}ms exceeded`, "ECONNABORTED", config, {}));
          else if (answer.status < 400) resolve(response);
          else
            reject(
              new AxiosError(
                `Request failed with status code ${answer.status}`,
                answer.status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
                config,
                {},
                response
              )
            );
        });
      };

      const signal = config.signal as AbortSignal | undefined;
      if (this.honourAbort && signal) {
        signal.addEventListener(
          "abort",
          () => {
            call.aborted = true;
            // Like axios' XHR adapter: a CanceledError that carries the request config.
            settle(() => reject(Object.assign(new CanceledError("canceled"), { config })));
          },
          { once: true }
        );
      }
      if (this.cold || this.hold?.(call)) this.held.push(run);
      else run();
    });

  private isAuthorized(call: ApiCall): boolean {
    const token = call.authorization?.replace(/^Bearer /, "") ?? "";
    return this.validAccessTokens.has(token);
  }

  private handle(call: ApiCall): Answer {
    for (const route of this.routes) {
      const answer = route(call);
      if (answer) return answer;
    }
    const { method, url } = call;
    const body = (call.body ?? {}) as Record<string, unknown>;

    if (method === "GET" && url === "/health") return { status: 204 };
    if (method === "POST" && url === "/auth/login") return { status: 200, data: this.issueTokens() };
    if (method === "POST" && url === "/auth/refresh") {
      if (typeof body.refreshToken === "string" && body.refreshToken === this.storedRefreshToken) {
        return { status: 200, data: this.issueTokens() };
      }
      return { status: 401, data: { message: "Invalid refresh token." } };
    }
    if (method === "POST" && url === "/auth/logout") {
      if (this.isAuthorized(call)) this.storedRefreshToken = null;
      if (typeof body.refreshToken === "string" && body.refreshToken === this.storedRefreshToken) {
        this.storedRefreshToken = null;
      }
      return { status: 204 };
    }

    if (!this.isAuthorized(call)) return { status: 401 };
    if (method === "GET" && url === "/categories") return { status: 200, data: [CATEGORY] };
    if (method === "GET" && url === "/tasktemplates") return { status: 200, data: [] };
    if (method === "GET" && url === "/tasks") return { status: 200, data: this.tasks };
    if (method === "POST" && url === "/tasks") {
      const task: Task = {
        id: `server-task-${this.tasks.length + 1}`,
        title: String(body.title),
        start: String(body.start),
        duration: Number(body.duration),
        categoryId: String(body.categoryId),
        categoryName: CATEGORY.name,
        categoryColor: CATEGORY.color,
      };
      this.tasks.push(task);
      return { status: 201, data: task };
    }
    if (method === "DELETE" && url.startsWith("/tasks/")) return { status: 204 };
    return { status: 404, data: { message: `No route for ${method} ${url}` } };
  }
}
