import { describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios, findElements } from "../../lib/test-render";
import { AmountPicker } from "../amount-picker";

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

const { CreditAmounts } = await import("./credits-panel");

type Co = Parameters<typeof CreditAmounts>[0]["co"];

function fakeCheckout(
	amount: number,
	setAmount: (n: 10 | 25 | 50 | 100) => void,
) {
	return {
		amount,
		setAmount,
		busy: false,
		error: null,
		checkout: async () => {},
	} as unknown as Co;
}

describe("credits amounts", () => {
	test("offers the four packs the API sells with the current one checked", () => {
		const html = renderToStaticMarkup(
			<CreditAmounts co={fakeCheckout(25, () => {})} />,
		);
		for (const usd of [10, 25, 50, 100]) {
			expect(html).toMatch(new RegExp(`<input[^>]*value="${usd}"`));
		}
		expect(Object.values(checkedRadios(html))).toEqual(["25"]);
	});

	test("choosing a pack hands checkout the same dollar amount as before", () => {
		const set: number[] = [];
		let tree: ReactElement | null = null;
		function Probe() {
			tree = CreditAmounts({
				co: fakeCheckout(25, (n) => set.push(n)),
			}) as ReactElement;
			return null;
		}
		renderToStaticMarkup(<Probe />);
		const picker = findElements(tree, AmountPicker)[0];
		const props = picker.props as unknown as {
			onChange: (v: string) => void;
		};
		props.onChange("50");
		props.onChange("100");
		props.onChange("999");
		expect(set).toEqual([50, 100]);
	});

	test("the page picker keeps the anchor the low-balance banner scrolls to", () => {
		const html = renderToStaticMarkup(
			<CreditAmounts co={fakeCheckout(25, () => {})} wide />,
		);
		expect(html).toContain('id="packs"');
	});
});
