import {
	INDEX_VIEW_COOKIE,
	type IndexViews,
	parseIndexViews,
} from "@/lib/index-view";
import { cookies } from "next/headers";

export async function savedIndexViews(): Promise<IndexViews> {
	return parseIndexViews((await cookies()).get(INDEX_VIEW_COOKIE)?.value);
}
