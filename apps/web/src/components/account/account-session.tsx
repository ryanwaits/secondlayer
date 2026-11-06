import { AccountFrame } from "@/components/account/account-frame";
import { CompactSeed } from "@/components/mobile/use-compact";
import { type AccountSeed, AccountSeedProvider } from "@/lib/account-data";
import { AuthSeed } from "@/lib/auth";
import { logColdStart } from "@/lib/server/cold-start";
import { savedCompact } from "@/lib/server/compact-view";
import { accountRead, accountReads } from "@/lib/server/dashboard-reads";
import { headStart } from "@/lib/server/head-start";
import { sessionToken } from "@/lib/server/session";
import type { Account } from "@/lib/types";
import { Suspense } from "react";

/** The account's balance for the nav chip and the account for `useAuth`.
 *  Renders nothing; it seeds the client stores. The reads draw on the
 *  request's head start: landed inside it, the seeds are in the first paint;
 *  past it they stream in under their own boundary, so no page waits for them. */
export async function AccountSeeds() {
	const startedAt = performance.now();
	const token = await sessionToken();
	const reads: Promise<SeedReads> = token
		? Promise.all([accountReads(token, ["billing"]), accountRead(token)])
		: Promise.resolve([{}, null]);
	const result = await headStart(reads);
	if (result.ready) return <Seeds reads={result.value} startedAt={startedAt} />;
	return (
		<Suspense fallback={null}>
			<LateSeeds pending={result.pending} startedAt={startedAt} />
		</Suspense>
	);
}

type SeedReads = readonly [AccountSeed, Account | null];

function Seeds({
	reads: [seed, account],
	startedAt,
}: {
	reads: SeedReads;
	startedAt: number;
}) {
	logColdStart("/account", startedAt);
	return (
		<>
			<AccountSeedProvider seed={seed} />
			<AuthSeed account={account} />
		</>
	);
}

async function LateSeeds({
	pending,
	startedAt,
}: {
	pending: Promise<SeedReads>;
	startedAt: number;
}) {
	return <Seeds reads={await pending} startedAt={startedAt} />;
}

/** Everything under /account that depends on who is asking. The cookie reads
 *  are local, so the frame is ready at once. A visitor with no session cookie
 *  gets the sign-in card, decided here and not by a flash of skeletons. */
export async function AccountSession({
	children,
}: {
	children: React.ReactNode;
}) {
	const [token, compact] = await Promise.all([sessionToken(), savedCompact()]);
	return (
		<CompactSeed saved={compact}>
			<AccountFrame signedOut={!token}>{children}</AccountFrame>
		</CompactSeed>
	);
}
