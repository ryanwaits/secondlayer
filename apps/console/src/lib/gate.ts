import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Server-side gate check, called from the console layout. The proxy handles
 * most paths, but the bare basePath route can slip past its matcher — this
 * is the backstop that makes the gate hold for every screen.
 */
export async function assertConsoleAccess(): Promise<void> {
	const gateToken =
		process.env.CONSOLE_TOKEN || process.env.INSTANCE_TOKEN || "";
	if (!gateToken) return;
	const jar = await cookies();
	if (jar.get("sl_console")?.value === gateToken) return;
	redirect("/token?next=%2F");
}
