/** File downloads: Content-Disposition parsing, fallback names and saving a Blob. */
import { describe, expect, it, vi } from "vitest";
import {
  OBJECT_URL_TTL_MS,
  fallbackExportFileName,
  parseContentDisposition,
  sanitizeFileName,
  saveBlob,
  type SaveBlobEnv,
} from "../download";

describe("parseContentDisposition", () => {
  it("reads a quoted filename", () => {
    expect(parseContentDisposition('attachment; filename="time-planner-analytics-2026-W40.pdf"')).toBe(
      "time-planner-analytics-2026-W40.pdf"
    );
  });

  it("reads an unquoted filename and ignores parameter case and spacing", () => {
    expect(parseContentDisposition("attachment;FILENAME = report.csv")).toBe("report.csv");
  });

  it("unescapes quoted-pairs and keeps ';' inside quotes", () => {
    expect(parseContentDisposition('attachment; filename="a \\"b\\"; c.pdf"')).toBe("a _b_; c.pdf");
  });

  it("prefers the RFC 5987 filename* (UTF-8, percent-encoded) over filename", () => {
    expect(
      parseContentDisposition(
        "attachment; filename=\"time-planner-analytics-2026-W40.pdf\"; filename*=UTF-8''time-planner-%C3%A5rsrapport-2026.pdf"
      )
    ).toBe("time-planner-årsrapport-2026.pdf");
    // filename* first in the header works the same
    expect(parseContentDisposition("attachment; filename*=utf-8'en'r%C3%A9sum%C3%A9.csv; filename=\"resume.csv\"")).toBe(
      "résumé.csv"
    );
  });

  it("decodes ISO-8859-1 ext-values", () => {
    expect(parseContentDisposition("attachment; filename*=iso-8859-1''%E6r%F8.pdf")).toBe("ærø.pdf");
  });

  it("falls back to filename when filename* is malformed", () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E0%A4%A; filename=\"plain.pdf\"")).toBe("plain.pdf");
    expect(parseContentDisposition("attachment; filename*=nonsense; filename=plain.pdf")).toBe("plain.pdf");
  });

  it("returns null when the header or the name is missing", () => {
    expect(parseContentDisposition(null)).toBeNull();
    expect(parseContentDisposition(undefined)).toBeNull();
    expect(parseContentDisposition("")).toBeNull();
    expect(parseContentDisposition("attachment")).toBeNull();
    expect(parseContentDisposition('attachment; filename=""')).toBeNull();
  });

  it("strips directories and characters file systems reject", () => {
    expect(parseContentDisposition('attachment; filename="../../etc/passwd"')).toBe("passwd");
    expect(parseContentDisposition('attachment; filename="C:\\\\temp\\\\x.pdf"')).toBe("x.pdf");
    expect(sanitizeFileName("re:port*?.pdf")).toBe("re_port_.pdf");
    expect(sanitizeFileName("...")).toBeNull();
  });
});

describe("fallbackExportFileName", () => {
  it("names the view and today's date", () => {
    expect(fallbackExportFileName("weekly", "pdf", "2026-10-11")).toBe("time-planner-analytics-weekly-2026-10-11.pdf");
    expect(fallbackExportFileName("monthly", "csv", "2027-01-01")).toBe("time-planner-analytics-monthly-2027-01-01.csv");
  });
});

describe("saveBlob", () => {
  function fakeEnv() {
    const link = {
      href: "",
      download: "",
      rel: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const timers: { handler: () => void; ms: number }[] = [];
    const env = {
      createObjectURL: vi.fn(() => "blob:http://localhost/abc"),
      revokeObjectURL: vi.fn(),
      document: {
        createElement: vi.fn(() => link),
        body: { appendChild: vi.fn() },
      },
      setTimeout: vi.fn((handler: () => void, ms: number) => {
        timers.push({ handler, ms });
        return timers.length;
      }),
    };
    return { env, link, timers };
  }

  it("clicks a temporary <a download> for an object URL and revokes it after 30 s", () => {
    const { env, link, timers } = fakeEnv();
    const blob = new Blob(["x"], { type: "application/pdf" });
    saveBlob(blob, "report.pdf", env as unknown as SaveBlobEnv);

    expect(env.createObjectURL).toHaveBeenCalledWith(blob);
    expect(env.document.createElement).toHaveBeenCalledWith("a");
    expect(link.href).toBe("blob:http://localhost/abc");
    expect(link.download).toBe("report.pdf");
    expect(link.rel).toBe("noopener");
    expect(env.document.body.appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);

    expect(env.revokeObjectURL).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(OBJECT_URL_TTL_MS);
    expect(OBJECT_URL_TTL_MS).toBe(30_000);
    timers[0]!.handler();
    expect(env.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/abc");
  });

  it("still removes the link and schedules the revoke when click() throws", () => {
    const { env, link, timers } = fakeEnv();
    link.click.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveBlob(new Blob(["x"]), "a.csv", env as unknown as SaveBlobEnv)).toThrow("blocked");
    expect(link.remove).toHaveBeenCalled();
    expect(timers).toHaveLength(1);
  });

  it("sanitizes the download name", () => {
    const { env, link } = fakeEnv();
    saveBlob(new Blob(["x"]), "../evil:name.pdf", env as unknown as SaveBlobEnv);
    expect(link.download).toBe("evil_name.pdf");
  });
});
