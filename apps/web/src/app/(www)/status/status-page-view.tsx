import { StatusClient } from "./status-client";

/** Wrapped in the marketing `.explore-wrap` container; the top nav and site
 *  footer come from the parent `(www)` layout. */
export function StatusPageView() {
	return (
		<main className="explore-wrap status-page">
			<StatusClient />
		</main>
	);
}
