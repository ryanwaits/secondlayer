import {
	OPEN_COOKIE,
	type OpenChoices,
	parseOpenChoices,
} from "@/lib/insight-open";
import { cookies } from "next/headers";

/** The findings the reader showed or hid, for the first render. */
export async function savedOpenChoices(): Promise<OpenChoices> {
	return parseOpenChoices((await cookies()).get(OPEN_COOKIE)?.value);
}
