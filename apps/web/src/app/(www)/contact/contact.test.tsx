import { describe, expect, mock, test } from "bun:test";
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

const ContactPage = (await import("./page")).default;
const PricingPage = (await import("../pricing/page")).default;

const contact = renderToStaticMarkup(
	await ContactPage({ searchParams: Promise.resolve({ from: "/pricing" }) }),
);
const pricing = renderToStaticMarkup(<PricingPage />);

describe("/contact", () => {
	test("labels every field a visitor fills in", () => {
		for (const label of [
			"Name",
			"Work email",
			"Company",
			"Rows a month, roughly",
			"What you&#x27;re building",
		]) {
			expect(contact).toContain(label);
		}
	});

	test("offers every volume bucket the API accepts", () => {
		for (const value of ["lt10m", "10m-100m", "100m-1b", "gt1b", "unsure"]) {
			expect(contact).toContain(`value="${value}"`);
		}
	});

	test("hides a honeypot input named website from people and assistive tech", () => {
		expect(contact).toContain('name="website"');
		expect(contact).toContain('tabindex="-1"');
		expect(contact).toContain('aria-hidden="true"');
	});

	test("promises a human reply without a mailing list", () => {
		expect(contact).toContain("Replies come from a person, not a list.");
	});
});

describe("/pricing talk to us", () => {
	test("links to the contact page carrying the page it came from", () => {
		expect(pricing).toContain('href="/contact?from=/pricing"');
	});
});
