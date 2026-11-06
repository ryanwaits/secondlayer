import { AccountFrame } from "@/components/account/account-frame";
import { CompactSeed } from "@/components/mobile/use-compact";
import { AccountSeedProvider } from "@/lib/account-data";
import { AuthSeed } from "@/lib/auth";
import { logColdStart } from "@/lib/server/cold-start";
import { savedCompact } from "@/lib/server/compact-view";
import { accountRead, accountReads } from "@/lib/server/dashboard-reads";
import { sessionToken } from "@/lib/server/session";
import { warmHighlighter } from "@/lib/server/warm-instance";
import { after } from "next/server";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/** The balance for the top bar's account menu, read once for every page under
 *  /account. The rest of the frame is the client shell. */
export default async function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// The highlighter loads once the response is out, so no first request waits
	// on it; the account pages that render code find it warm afterwards.
	after(warmHighlighter);
	const startedAt = performance.now();
	const token = await sessionToken();
	const [[seed, account], compact] = await Promise.all([
		token
			? Promise.all([accountReads(token, ["billing"]), accountRead(token)])
			: Promise.resolve([{}, null] as const),
		savedCompact(),
	]);
	logColdStart("/account", startedAt);
	return (
		<AccountSeedProvider seed={seed}>
			<AuthSeed account={account} />
			<CompactSeed saved={compact}>
				<AccountFrame signedOut={!token}>{children}</AccountFrame>
			</CompactSeed>
		</AccountSeedProvider>
	);
}
