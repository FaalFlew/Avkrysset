import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Every spec runs once per zone below. The zone is applied per project through `env.TZ` in a
 * forked process (Git Bash strips TZ for native programs, so it cannot come from the shell);
 * each spec file asserts that the zone was really applied.
 *
 * Chosen for: UTC; DST in both hemispheres (Oslo, New York, Sydney, Santiago); a midnight DST
 * gap (Sao Paulo, historic); half-hour and 45-minute offsets (St Johns, Kolkata, Kathmandu,
 * Chatham); a 30-minute DST shift (Lord Howe); and the date-line extremes (Kiritimati +14,
 * Pago Pago -11).
 */
export const TEST_TIME_ZONES = [
  "UTC",
  "Europe/Oslo",
  "America/New_York",
  "America/St_Johns",
  "America/Sao_Paulo",
  "America/Santiago",
  "Australia/Sydney",
  "Australia/Lord_Howe",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
] as const;

const ARCHITECTURE_SPEC = "src/**/architecture.spec.ts";
/**
 * Component specs that mount with the in-memory renderer (src/components/analytics/__tests__/
 * fakeRenderer.ts) need client-compiled .vue files; everything else keeps the SSR transform
 * (renderToString).
 */
const WEB_TRANSFORM_SPECS = ["**/src/**/*.web.spec.ts"];

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      pool: "forks",
      // The property specs sweep every 15-minute slot of a year; 13 zones run in parallel.
      testTimeout: 30_000,
      testTransformMode: { web: WEB_TRANSFORM_SPECS },
      projects: [
        {
          extends: true,
          test: { name: "architecture", include: [ARCHITECTURE_SPEC] },
        },
        ...TEST_TIME_ZONES.map((tz) => ({
          extends: true as const,
          test: {
            name: `tz:${tz}`,
            env: { TZ: tz },
            include: ["src/**/*.spec.ts"],
            exclude: ["**/node_modules/**", ARCHITECTURE_SPEC],
          },
        })),
      ],
    },
  })
);
