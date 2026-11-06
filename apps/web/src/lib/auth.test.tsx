import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
	usePathname: () => "/account",
	useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { AuthProvider, AuthSeed, authSnapshot, useAuth } = await import(
	"./auth"
);

const account = {
	id: "acct_1",
	email: "a@example.com",
} as unknown as Parameters<typeof AuthSeed>[0]["account"];

function Probe() {
	const { loading, account } = useAuth();
	return <p>{loading ? "loading" : (account?.email ?? "signed-out")}</p>;
}

const tree = (seed: typeof account) => (
	<AuthProvider>
		<Probe />
		<AuthSeed account={seed} />
	</AuthProvider>
);

afterEach(() => {
	(globalThis as { window?: unknown }).window = undefined;
});

describe("AuthSeed", () => {
	test("the server render never writes the shared module state", () => {
		renderToStaticMarkup(tree(account));
		expect(authSnapshot().account).toBeNull();
		expect(authSnapshot().loading).toBe(true);
	});

	test("the browser starts signed in, not loading, from the server's account", () => {
		globalThis.window = {} as Window & typeof globalThis;
		renderToStaticMarkup(tree(account));
		expect(authSnapshot()).toEqual({ account, loading: false });
	});

	test("an unseeded page keeps waiting for the browser's own read", () => {
		globalThis.window = {} as Window & typeof globalThis;
		const before = authSnapshot();
		renderToStaticMarkup(tree(null));
		expect(authSnapshot()).toBe(before);
	});
});
