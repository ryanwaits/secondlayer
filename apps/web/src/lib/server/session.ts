import { cookies } from "next/headers";

/** Reading it makes the page dynamic, which is the point: the HTML is per account. */
export async function sessionToken(): Promise<string | null> {
	return (await cookies()).get("sl_session")?.value ?? null;
}
