import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/account",
	useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { AuthProvider } = await import("@/lib/auth");
const { AccountFrame } = await import("./account-frame");

describe("AccountFrame", () => {
	test("a server that saw no session renders the sign-in card and none of the page", () => {
		const html = renderToStaticMarkup(
			<AuthProvider>
				<AccountFrame signedOut>
					<p>page body</p>
				</AccountFrame>
			</AuthProvider>,
		);
		expect(html).toContain("Sign in to get a key");
		expect(html).not.toContain("page body");
	});
});
