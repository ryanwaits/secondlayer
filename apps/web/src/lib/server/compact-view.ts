import { COMPACT_COOKIE, parseCompact } from "@/lib/compact-view";
import { cookies } from "next/headers";

export async function savedCompact(): Promise<boolean | null> {
	return parseCompact((await cookies()).get(COMPACT_COOKIE)?.value);
}
