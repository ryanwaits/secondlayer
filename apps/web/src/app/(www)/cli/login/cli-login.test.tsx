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
	name: "ryans-macbook",
	busy: false,
	error: null,
	onName: noop,
	onApprove: noop,
	onCancel: noop,
};

describe("CliLoginCard", () => {
	test("review shows the machine, the code and a prefilled key name", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "review", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).toContain("Approve sl on ryans-macbook?");
		expect(html).toContain("WDJB-MJHT");
		expect(html).toContain('value="ryans-macbook"');
		expect(html).toContain("Approve");
		expect(html).toContain("Cancel");
	});

	test("approved points at Keys", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "approved", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).toContain("signed in on ryans-macbook");
		expect(html).toContain("/account/keys");
	});

	test("cancelled and expired say what happened", async () => {
		const cancelled = await renderAsync(
			<CliLoginCard {...props} view={{ kind: "cancelled" }} />,
		);
		expect(cancelled).toContain("Nothing was made.");
		const expired = await renderAsync(
			<CliLoginCard {...props} view={{ kind: "expired" }} />,
		);
		expect(expired).toContain("This code expired.");
		expect(expired).toContain("sl login");
	});
});
