import { describe, expect, mock, test } from "bun:test";
import { highlight } from "@/lib/highlight";
import { renderToStaticMarkup } from "react-dom/server";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

// CodeBlock is an async server component; renderToStaticMarkup needs a sync stub.
mock.module("@/components/code-block", () => ({
	CodeBlock: ({ code }: { code: string }) => <pre data-codeblock>{code}</pre>,
}));

const VerifyPage = (await import("./verify/page")).default;
const PricingPage = (await import("./pricing/page")).default;

const verify = renderToStaticMarkup(<VerifyPage />);
const pricing = renderToStaticMarkup(<PricingPage />);

describe("/verify", () => {
	test("has one h1 and states the limits plainly", () => {
		expect(verify.match(/<h1>/g)).toHaveLength(1);
		expect(verify).toContain("never a pass");
		expect(verify).toContain("not cover");
		expect(verify).not.toContain("—");
	});

	test("proofs need no key and carry per-IP limits", () => {
		expect(verify).toContain("No key needed");
		expect(verify).toContain("10 req/s per IP (20 with a key)");
		expect(verify).toContain("1 req/s for witnesses (2 with a key)");
		expect(verify).not.toContain("req/s per account");
		expect(verify).not.toContain("SECONDLAYER_API_KEY");
		expect(verify).not.toContain("trustless");
	});

	test("the SDK snippet renders through CodeBlock without an apiKey", () => {
		expect(verify).toContain("data-codeblock");
		expect(verify).toContain(
			"No key needed; add apiKey for higher rate limits.",
		);
		expect(verify).not.toContain("apiKey:");
	});

	test("the checkpoint is the first, dashed box of the chain", () => {
		expect(verify).toContain("trusted as-is");
		expect(verify).toContain('stroke-dasharray="4 3"');
	});

	test("illustrative values are labelled as examples", () => {
		expect(verify).toContain("example output");
		expect(verify).toContain("example checkpoint");
	});

	test("the shared highlighter emits dual-theme shiki markup", async () => {
		const html = await highlight("const a = 1;", "typescript");
		expect(html).toContain('class="shiki');
	});
});

describe("/pricing", () => {
	test("has one h1 and an estimator", () => {
		expect(pricing.match(/<h1>/g)).toHaveLength(1);
		expect(pricing).toContain("Monthly estimate");
		expect(pricing).toContain('type="range"');
	});

	test("prices by rows, never queries, requests or API calls", () => {
		const lower = pricing.toLowerCase();
		expect(lower).not.toContain("query");
		expect(lower).not.toContain("request");
		expect(lower).not.toContain("api call");
		expect(pricing).not.toContain("—");
	});

	test("prices come from the mirror", () => {
		expect(pricing).toContain("$5 / 1M rows");
		expect(pricing).toContain("$2 / 1M once the month passes $50");
		expect(pricing).toContain("$0.028 / GB-hour");
		expect(pricing).toContain("$10 / 1M events");
		expect(pricing).toContain("$0.05 blocks or tx");
		expect(pricing).toContain("$43.32");
	});

	test("the sample statement is labelled as an example", () => {
		expect(pricing).toContain("example statement");
	});

	test("no Sentinel units or plan tiers", () => {
		expect(pricing.toLowerCase()).not.toContain("sentinel");
		expect(pricing).not.toContain(" Pro ");
	});
});
