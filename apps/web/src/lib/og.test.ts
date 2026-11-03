import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ogCards from "@/generated/og-cards.json";
import { ogImage, socialMeta } from "./og";

const OG_DIR = join(import.meta.dir, "../../public/og");
const manifest: Record<string, string> = ogCards;

describe("share card manifest", () => {
	test("every PNG in public/og has an entry and every entry has a PNG", async () => {
		const files = (await readdir(OG_DIR)).filter((f) => f.endsWith(".png"));
		expect(Object.keys(manifest).sort()).toEqual(files.sort());
	});

	test("every hash is the first 8 hex of the SHA-256 of the card's bytes", async () => {
		for (const [file, hash] of Object.entries(manifest)) {
			const bytes = await readFile(join(OG_DIR, file));
			const expected = createHash("sha256")
				.update(bytes)
				.digest("hex")
				.slice(0, 8);
			expect(hash).toBe(expected);
		}
	});
});

describe("ogImage", () => {
	test("appends the card's content hash as a version query", () => {
		expect(ogImage("/og/home.png")).toMatch(/^\/og\/home\.png\?v=[0-9a-f]{8}$/);
	});

	test("throws for a path with no generated card", () => {
		expect(() => ogImage("/og/missing.png")).toThrow();
	});
});

describe("socialMeta", () => {
	test("puts the versioned card URL in both Open Graph and Twitter images", () => {
		const meta = socialMeta({
			title: "Home",
			description: "d",
			image: "/og/home.png",
			path: "/",
		});
		const versioned = ogImage("/og/home.png");
		expect(meta.openGraph?.images).toEqual([
			{ url: versioned, width: 1200, height: 630, alt: "Home" },
		]);
		expect(meta.twitter?.images).toEqual([versioned]);
	});
});
