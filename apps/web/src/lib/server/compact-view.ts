import { COMPACT_COOKIE, parseCompact } from "@/lib/compact-view";
import { cookies } from "next/headers";

/** Whether the last visit was at the phone layout, for the first render.
 *  Null when never recorded. */
export async function savedCompact(): Promise<boolean | null> {
	return parseCompact((await cookies()).get(COMPACT_COOKIE)?.value);
}
