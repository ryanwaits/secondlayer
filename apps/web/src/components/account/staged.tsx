import { headStart } from "@/lib/server/head-start";
import { Suspense } from "react";

/**
 * A page's data with a head start. If `load` settles inside the request's
 * budget the page is sent whole, as one paint: no boundary, no skeleton. Past
 * it, the skeleton goes out with the frame and the data streams in behind it.
 * The layout's own reads draw on the same budget, so the two together never
 * hold the first byte longer than it allows. A page that streams in fades in;
 * one that lands in the head start never animates.
 */
export async function Staged<T>({
	load,
	fallback,
	children,
}: {
	load: Promise<T>;
	fallback: React.ReactNode;
	children: (value: T) => React.ReactNode;
}) {
	const result = await headStart(load);
	if (result.ready) return <>{children(result.value)}</>;
	return (
		<Suspense fallback={fallback}>
			<Late pending={result.pending}>{children}</Late>
		</Suspense>
	);
}

async function Late<T>({
	pending,
	children,
}: {
	pending: Promise<T>;
	children: (value: T) => React.ReactNode;
}) {
	return <div className="acct-region stream-in">{children(await pending)}</div>;
}
