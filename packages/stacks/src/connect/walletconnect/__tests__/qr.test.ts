import { describe, expect, test } from "bun:test";
import jsQR from "jsqr";
import { qrSvg } from "../qr.ts";

const WC_URI =
	"wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303";

function scan(data: string): string | null {
	const svg = qrSvg(data, { size: 1000 });
	const modules = [...svg.matchAll(/M([\d.]+),([\d.]+)h([\d.]+)/g)];
	const scale = Number(modules[0]?.[3]);
	const width = Math.round(1000 / scale);
	const pixelsPerModule = 4;
	const side = width * pixelsPerModule;
	const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
	for (const [, x, y] of modules) {
		const col = Math.round(Number(x) / scale);
		const row = Math.round(Number(y) / scale);
		for (let dy = 0; dy < pixelsPerModule; dy++) {
			for (let dx = 0; dx < pixelsPerModule; dx++) {
				const offset =
					((row * pixelsPerModule + dy) * side + col * pixelsPerModule + dx) *
					4;
				rgba.fill(0, offset, offset + 3);
			}
		}
	}
	return jsQR(rgba, side, side)?.data ?? null;
}

describe("qr", () => {
	test.each([
		["version 1", 10],
		["version 2", 30],
		["version 6", 130],
		["version 7", 150],
		["version 9", 225],
		["version 10", 270],
	])("a scanner reads back the data at %s", (_, length) => {
		const data = "a".repeat(length);
		expect(scan(data)).toBe(data);
	});

	test("a scanner reads back a WalletConnect pairing URI", () => {
		expect(scan(WC_URI)).toBe(WC_URI);
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

	test("deterministic output", () => {
		expect(qrSvg("hello")).toBe(qrSvg("hello"));
	});

	test("throws for data too long", () => {
		expect(() => qrSvg("x".repeat(300))).toThrow("QR data too long");
	});
});
