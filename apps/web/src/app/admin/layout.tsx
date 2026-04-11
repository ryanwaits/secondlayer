import { isAdmin } from "@/lib/admin";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Account } from "@/lib/types";
import { redirect } from "next/navigation";

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const session = await getSessionFromCookies();
	if (!session) redirect("/");

	try {
		const account = await apiRequest<Account>("/api/accounts/me", {
			sessionToken: session,
		});
		if (!isAdmin(account.email)) redirect("/");
	} catch {
		redirect("/");
	}

	return <>{children}</>;
}
