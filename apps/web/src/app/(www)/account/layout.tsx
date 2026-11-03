import { AccountFrame } from "@/components/account/account-frame";
import { AccountSeedProvider } from "@/lib/account-data";
import { accountReads } from "@/lib/server/dashboard-reads";
import { sessionToken } from "@/lib/server/session";

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
	const token = await sessionToken();
	const seed = token ? await accountReads(token, ["billing"]) : {};
	return (
		<AccountSeedProvider seed={seed}>
			<AccountFrame>{children}</AccountFrame>
		</AccountSeedProvider>
	);
}
