import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusGridView } from "./status-grid-view";

describe("status page visual smoke", () => {
	test("renders all three public signals", () => {
		const html = renderToStaticMarkup(
			<StatusGridView
				incidentHeading="No active incidents"
				snapshot={{
					health: {
						state: "ok",
						label: "OK",
						description:
							"The API is reachable and ingest lag is under 60 seconds.",
					},
					tip: {
						block_height: 182447,
						burn_block_height: 871249,
						index_block_hash: "0x1234567890abcdef1234567890abcdef",
						lag_seconds: 3,
					},
					lastChecked: new Date("2026-05-03T20:30:45Z"),
					error: null,
				}}
			/>,
		);

		expect(html).toContain("API health");
		expect(html).toContain("Current chain tip");
		expect(html).toContain("Incident note");
		expect(html).toContain("No active incidents");
		expect(html).toContain("182,447");
		expect(html).toContain("0x12345678...abcdef");
	});
});
