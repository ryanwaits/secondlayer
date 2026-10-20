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

const { CliLoginCard, displayClientName } = await import("./cli-login");

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

	test("plain review keeps the sl wording and no Sentinel lines", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "review", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).toContain("sl logout");
		expect(html).not.toContain("Sentinel");
		expect(html).not.toContain("Only approve a code you started");
		expect(html).not.toContain("reported by the device");
	});

	test("sentinel review names Sentinel, its logout, and warns", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{
					kind: "review",
					clientName: "ryans-macbook",
					product: "sentinel",
				}}
			/>,
		);
		expect(html).toContain("Approve <strong>Sentinel</strong> on");
		expect(html).toContain("ryans-macbook?");
		expect(html).toContain("<code>sentinel logout</code>");
		expect(html).not.toContain("sl logout");
		expect(html).toContain("Only approve a code you started");
		expect(html).toContain("reported by the device");
		expect(html).toContain("WDJB-MJHT");
	});

	test("sentinel review says Sentinel bills separately and never spends the balance", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{
					kind: "review",
					clientName: "ryans-macbook",
					product: "sentinel",
				}}
			/>,
		);
		expect(html).toContain(
			"Sentinel bills separately and never spends this account&#x27;s balance.",
		);
		expect(html).not.toContain("(now");
	});

	test("plain review never mentions the balance", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "review", clientName: "ryans-macbook" }}
			/>,
		);
		expect(html).not.toContain("balance");
	});

	test("sentinel cancelled and expired name Sentinel", async () => {
		const cancelled = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "cancelled", product: "sentinel" }}
			/>,
		);
		expect(cancelled).toContain("Sentinel stays signed out.");
		const expired = await renderAsync(
			<CliLoginCard
				{...props}
				view={{ kind: "expired", product: "sentinel" }}
			/>,
		);
		expect(expired).toContain("sentinel login");
	});

	test("a hostile client name renders as escaped plain text", async () => {
		const html = await renderAsync(
			<CliLoginCard
				{...props}
				view={{
					kind: "review",
					clientName: '<img src=x onerror="alert(1)">',
					product: "sentinel",
				}}
			/>,
		);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});
});

describe("displayClientName", () => {
	test("strips control, zero-width and bidi characters", () => {
		expect(displayClientName("ryans\u202Ekoobcam")).toBe("ryanskoobcam");
		expect(displayClientName("a\u0000b\u001bc\u007fd\u200Be\u2066f")).toBe(
			"abcdef",
		);
		expect(displayClientName("my\n\tmac")).toBe("my mac");
	});

	test("caps the length and names an empty result", () => {
		const long = "x".repeat(200);
		expect(displayClientName(long)).toBe(`${"x".repeat(64)}…`);
		expect(displayClientName("\u202E\u200B ")).toBe("an unnamed machine");
		expect(displayClientName("ryans-macbook")).toBe("ryans-macbook");
	});
});
