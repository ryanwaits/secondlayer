import { ConsoleShell } from "@/components/console/shell";
import { isAdmin } from "@/lib/admin";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { TopbarProvider } from "@/lib/topbar-context";
import type { Account } from "@/lib/types";
import { redirect } from "next/navigation";
import "@/styles/console.css";

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

	return (
		<TopbarProvider>
			<ConsoleShell>{children}</ConsoleShell>
		</TopbarProvider>
	);
}
