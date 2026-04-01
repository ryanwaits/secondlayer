import { ConsoleShell } from "@/components/console/shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import "@/styles/console.css";

export default async function ConsoleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const cookieStore = await cookies();
	const session = cookieStore.get("sl_session");

	if (!session) {
		redirect("/");
	}

	return <ConsoleShell>{children}</ConsoleShell>;
}
