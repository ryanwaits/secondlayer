import { afterEach, describe, expect, test } from "bun:test";
import { renderEmail } from "./render.ts";
import { sendEmail } from "./send.ts";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.EMAIL_FROM;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
	else process.env.RESEND_API_KEY = originalApiKey;
	if (originalFrom === undefined) delete process.env.EMAIL_FROM;
	else process.env.EMAIL_FROM = originalFrom;
});

describe("renderEmail", () => {
	test("escapes a script tag in the HTML output", () => {
		const { html } = renderEmail({
			heading: "Heading",
			paragraphs: ['<script>alert("hi")</script>'],
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	test("text output has no HTML tags", () => {
		const { text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph.", "Another one."],
			facts: [{ label: "Balance", value: "$5.00" }],
			cta: {
				label: "Add credits",
				url: "https://secondlayer.tools/account#usage",
			},
			footnote: "A footnote.",
		});
		expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
	});

	test("cta label and url appear in both html and text", () => {
		const cta = {
			label: "Add credits",
			url: "https://secondlayer.tools/account#usage",
		};
		const { html, text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph."],
			cta,
		});
		expect(html).toContain(cta.url);
		expect(html).toContain(cta.label);
		expect(text).toContain(cta.url);
		expect(text).toContain(cta.label);
	});

	test("facts render as label: value lines in text", () => {
		const { text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph."],
			facts: [
				{ label: "Balance", value: "$5.00" },
				{ label: "Spending", value: "$0.50/day" },
			],
		});
		expect(text).toContain("Balance: $5.00");
		expect(text).toContain("Spending: $0.50/day");
	});

	test("a code renders as a letter-spaced box in html and a Code: line in text", () => {
		const { html, text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph."],
			code: "123456",
		});
		expect(html).toContain("123456");
		expect(html).toContain("letter-spacing");
		expect(text).toContain("Code: 123456");
	});

	test("preheader rides hidden in the html and stays out of the text", () => {
		const { html, text } = renderEmail({
			heading: "Heading",
			preheader: "Expires in 15 minutes.",
			paragraphs: ["A paragraph."],
		});
		expect(html).toContain("display: none");
		expect(html).toContain("Expires in 15 minutes.");
		expect(text).not.toContain("Expires in 15 minutes.");
	});

	test("a status shows as a chip in the figure bar and a line in text", () => {
		const { html, text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph."],
			facts: [{ label: "Balance", value: "$0.00" }],
			figure: "credits",
			status: { tone: "alarm", text: "Stopped" },
		});
		expect(html).toContain("credits");
		expect(html).toContain("sl-dot-alarm");
		expect(text).toContain("Stopped");
	});

	test("every email ends with the brand footer in both parts", () => {
		const { html, text } = renderEmail({
			heading: "Heading",
			paragraphs: ["A paragraph."],
			footnote: "Why you got this.",
		});
		expect(html).toContain("Instant data for apps on Bitcoin");
		expect(
			text.endsWith("Secondlayer · Instant data for apps on Bitcoin"),
		).toBe(true);
		expect(text).toContain("Why you got this.");
	});
});

describe("sendEmail", () => {
	test("skips and warns when RESEND_API_KEY is unset, without throwing", async () => {
		delete process.env.RESEND_API_KEY;
		let fetchCalled = false;
		globalThis.fetch = (async () => {
			fetchCalled = true;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const result = await sendEmail({
			to: "someone@example.com",
			subject: "Subject",
			html: "<p>hi</p>",
			text: "hi",
		});

		expect(result).toEqual({ skipped: true });
		expect(fetchCalled).toBe(false);
	});

	test("posts to Resend with the configured from address when a key is set", async () => {
		process.env.RESEND_API_KEY = "test-key";
		process.env.EMAIL_FROM = "secondlayer <noreply@secondlayer.tools>";
		let capturedBody: Record<string, unknown> | undefined;
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			capturedBody = JSON.parse(init.body as string);
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const result = await sendEmail({
			to: "someone@example.com",
			subject: "Subject",
			html: "<p>hi</p>",
			text: "hi",
		});

		expect(result).toEqual({ skipped: false });
		expect(capturedBody?.from).toBe("secondlayer <noreply@secondlayer.tools>");
		expect(capturedBody?.to).toEqual(["someone@example.com"]);
	});

	test("sets reply_to only when a reply-to address is given", async () => {
		process.env.RESEND_API_KEY = "test-key";
		const bodies: Record<string, unknown>[] = [];
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			bodies.push(JSON.parse(init.body as string));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const base = {
			to: "ops@example.com",
			subject: "Subject",
			html: "<p>hi</p>",
			text: "hi",
		};
		await sendEmail(base);
		await sendEmail({ ...base, replyTo: "sender@example.com" });

		expect("reply_to" in bodies[0]).toBe(false);
		expect(bodies[1].reply_to).toEqual(["sender@example.com"]);
	});

	test("throws with status and body excerpt on a non-2xx response", async () => {
		process.env.RESEND_API_KEY = "test-key";
		globalThis.fetch = (async () =>
			new Response("bad request details", {
				status: 422,
			})) as unknown as typeof fetch;

		await expect(
			sendEmail({
				to: "someone@example.com",
				subject: "Subject",
				html: "<p>hi</p>",
				text: "hi",
			}),
		).rejects.toThrow(/422/);
	});
});
