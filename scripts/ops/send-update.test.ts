import { describe, expect, test } from "bun:test";
import { buildEmail, parseEmailFile, resolveXPost } from "./send-update.ts";

const example = await Bun.file(
	new URL("./updates/example-post.json", import.meta.url),
).json();

describe("parseEmailFile", () => {
	test("accepts the example post", () => {
		expect(parseEmailFile(example).key).toBe("post-clarity-state-from-genesis");
	});

	test("rejects a missing key", () => {
		const { key: _key, ...rest } = example;
		expect(() => parseEmailFile(rest)).toThrow(/key is required/);
	});

	test("rejects a key with uppercase or spaces", () => {
		expect(() => parseEmailFile({ ...example, key: "Bad Key" })).toThrow(
			/key must match/,
		);
	});

	test("rejects an unknown field and names it", () => {
		expect(() => parseEmailFile({ ...example, bogus: 1 })).toThrow(
			/unknown field: bogus/,
		);
	});

	test("rejects a missing cta url", () => {
		expect(() =>
			parseEmailFile({ ...example, cta: { label: "Read" } }),
		).toThrow(/cta/);
	});
});

const ready = await resolveXPost(parseEmailFile(example));

describe("buildEmail", () => {
	const built = buildEmail(ready, "tok");

	test("carries the unsubscribe link for the token", () => {
		expect(built.html).toContain("/updates/unsubscribe?t=tok");
	});

	test("highlights the excerpt mark", () => {
		expect(built.html).toContain("reserve[token-wkiki]");
	});

	test("includes the list footnote", () => {
		expect(built.html).toContain(
			"You get these because you subscribed at secondlayer.tools/blog.",
		);
	});

	test("sets one-click unsubscribe headers", () => {
		expect(built.headers["List-Unsubscribe-Post"]).toBe(
			"List-Unsubscribe=One-Click",
		);
		expect(built.headers["List-Unsubscribe"]).toContain("t=tok");
	});
});

const launch = await Bun.file(
	new URL("./updates/example-x-launch.json", import.meta.url),
).json();

describe("a launch that lives on X", () => {
	const fx = {
		tweet: {
			url: "https://x.com/ryan_waits/status/2118419916541870227",
			text: "the full replay of @Stacks is almost done",
			created_at: "Thu Nov 05 19:07:21 +0000 2026",
			author: {
				name: "ryanwaits",
				screen_name: "ryan_waits",
				avatar_url: "https://pbs.twimg.com/profile_images/a_200x200.jpg",
			},
			media: {
				photos: [{ url: "https://pbs.twimg.com/media/b.jpg?name=orig" }],
			},
		},
	};
	const fetcher = (async () =>
		new Response(JSON.stringify(fx))) as unknown as typeof fetch;

	test("accepts the example, with the post given by URL", () => {
		expect(parseEmailFile(launch).xPost).toBe(
			"https://x.com/ryan_waits/status/2118419916541870227",
		);
	});

	test("rejects an xPost that isn't a post URL", () => {
		expect(() =>
			parseEmailFile({ ...launch, xPost: "https://x.com/ryan_waits" }),
		).toThrow(/xPost must be/);
	});

	test("fills author, text, date and a mail-sized photo from the URL", async () => {
		const { xPost } = await resolveXPost(parseEmailFile(launch), fetcher);
		expect(xPost).toEqual({
			url: fx.tweet.url,
			author: {
				name: "ryanwaits",
				handle: "ryan_waits",
				avatarUrl: fx.tweet.author.avatar_url,
			},
			text: fx.tweet.text,
			date: "2026-11-05T19:07:21.000Z",
			image: { url: "https://pbs.twimg.com/media/b.jpg?name=medium" },
		});
	});

	test("a post that can't be read stops the send with what to do", async () => {
		const missing = (async () =>
			new Response("{}", { status: 404 })) as unknown as typeof fetch;
		await expect(resolveXPost(parseEmailFile(launch), missing)).rejects.toThrow(
			/full object/,
		);
	});

	test("the email shows the post as a card with the author and date", async () => {
		const file = await resolveXPost(parseEmailFile(launch), fetcher);
		const { html, text } = buildEmail(file, "tok");
		expect(html).toContain("@ryan_waits &middot; Nov 5, 2026");
		expect(html).toContain('href="https://x.com/Stacks"');
		expect(html).toContain("b.jpg?name=medium");
		expect(text).toContain("ryanwaits (@ryan_waits) · Nov 5, 2026");
	});
});
