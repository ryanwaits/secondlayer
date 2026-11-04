import {
	INDEX_VIEW_COOKIE,
	type IndexViews,
	parseIndexViews,
} from "@/lib/index-view";
import { cookies } from "next/headers";

/** The view each index page was last left in, for the first render. */
export async function savedIndexViews(): Promise<IndexViews> {
	return parseIndexViews((await cookies()).get(INDEX_VIEW_COOKIE)?.value);
}
