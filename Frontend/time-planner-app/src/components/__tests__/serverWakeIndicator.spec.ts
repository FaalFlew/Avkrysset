/**
 * ServerWakeIndicator: the "Waking up the server…" pill appears only while a mutation has been
 * pending for 3 s, announces itself politely, and moves above a visible toast. Rendered with Vue's
 * server renderer (no DOM test environment); the pill is teleported to <body>.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString, type SSRContext } from "vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import ServerWakeIndicator from "../ServerWakeIndicator.vue";
import { resetSlowMutations, SLOW_MUTATION_MS, trackMutation } from "@/services/slowRequests";
import { useUIStore } from "@/stores/uiStore";

(globalThis as { window?: unknown }).window ??= globalThis;

async function render(): Promise<string> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const app = createSSRApp(ServerWakeIndicator);
  app.use(pinia);
  const context: SSRContext = {};
  await renderToString(app, context);
  return String((context.teleports as Record<string, string> | undefined)?.body ?? "");
}

afterEach(() => {
  resetSlowMutations();
  vi.useRealTimers();
});

describe("ServerWakeIndicator", () => {
  it("renders nothing visible while no mutation is slow", async () => {
    const html = await render();
    expect(html).not.toContain("Waking up the server");
    expect(html).toContain('role="status"');
  });

  it("shows the pill (and the live-region text) once a mutation has waited 3 s", async () => {
    vi.useFakeTimers();
    const done = trackMutation();
    vi.advanceTimersByTime(SLOW_MUTATION_MS);
    const html = await render();
    expect(html).toContain("Waking up the server…");
    expect(html).toContain("Saving is taking longer than usual");
    expect(html).not.toContain("wake-region--raised");
    done();
    expect(await render()).not.toContain("Waking up the server…");
  });

  it("sits above a visible toast", async () => {
    vi.useFakeTimers();
    trackMutation();
    vi.advanceTimersByTime(SLOW_MUTATION_MS);
    const pinia = createPinia();
    setActivePinia(pinia);
    useUIStore().showToast("Task deleted", "info");
    const app = createSSRApp(ServerWakeIndicator);
    app.use(pinia);
    const context: SSRContext = {};
    await renderToString(app, context);
    expect(String((context.teleports as Record<string, string>).body)).toContain("wake-region--raised");
  });
});
