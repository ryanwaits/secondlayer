import { ConsoleShell } from "@/components/console/shell";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { TopbarProvider } from "@/lib/topbar-context";
import type { Account } from "@/lib/types";
import { redirect } from "next/navigation";
import "@/styles/console.css";

export default async function ConsoleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const session = await getSessionFromCookies();
	if (!session) redirect("/login");

	let invalid = false;
	try {
		await apiRequest<Account>("/api/accounts/me", { sessionToken: session });
	} catch {
		invalid = true;
	}
	if (invalid) redirect("/login");

	return (
		<TopbarProvider>
			<ConsoleShell>{children}</ConsoleShell>
		</TopbarProvider>
	);
}
