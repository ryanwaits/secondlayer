import { test, expect, describe } from "bun:test";
import { qrSvg } from "../qr.ts";

describe("qr", () => {
  test("returns valid SVG string", () => {
    const svg = qrSvg("https://example.com");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("xmlns");
  });

  test("contains path data for modules", () => {
    const svg = qrSvg("test");
    expect(svg).toContain("<path");
    expect(svg).toContain('fill="#000000"');
  });

  test("respects size option", () => {
    const svg = qrSvg("test", { size: 200 });
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
  });

  test("respects color options", () => {
    const svg = qrSvg("test", { dark: "#ff0000", light: "#00ff00" });
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#00ff00"');
  });

  test("handles WC URI format", () => {
    const uri =
      "wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303";
    const svg = qrSvg(uri);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  test("deterministic output", () => {
    const a = qrSvg("hello");
    const b = qrSvg("hello");
    expect(a).toBe(b);
  });

  test("different data produces different output", () => {
    const a = qrSvg("hello");
    const b = qrSvg("world");
    expect(a).not.toBe(b);
  });

  test("throws for data too long", () => {
    expect(() => qrSvg("x".repeat(300))).toThrow("QR data too long");
  });
});
