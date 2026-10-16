import { describe, expect, mock, test } from "bun:test";
import { renderAsync } from "@/lib/test-render";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ replace: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { CliLoginCard } = await import("./cli-login");

const noop = () => {};
const props = {
	code: "WDJB-MJHT",
	busy: false,
	error: null,
	onApprove: noop,
	onCancel: noop,
};

describe("CliLoginCard", () => {
	test("review shows the machine and the code, and asks for no key name", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "review", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).toContain("Approve sl on ryans-macbook?");
		expect(html).toContain("WDJB-MJHT");
		expect(html).not.toContain("<input");
		expect(html).not.toContain("API key");
		expect(html).toContain("Approve");
		expect(html).toContain("Cancel");
	});

	test("approved says the machine is signed in, with no pointer to Keys", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "approved", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).toContain("signed in on ryans-macbook");
		expect(html).not.toContain("/account/keys");
	});

	test("cancelled and expired say what happened", async () => {
		const cancelled = await renderAsync(
			<CliLoginCard {...props} view={{ kind: "cancelled" }} />,
		);
		expect(cancelled).toContain("sl stays signed out.");
		const expired = await renderAsync(
			<CliLoginCard {...props} view={{ kind: "expired" }} />,
		);
		expect(expired).toContain("This code expired.");
		expect(expired).toContain("sl login");
	});
});
