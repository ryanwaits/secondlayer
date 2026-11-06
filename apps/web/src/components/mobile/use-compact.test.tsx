import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CompactSeed, useCompact } from "./use-compact";

function Probe() {
	return <span>{useCompact() ? "phone" : "desktop"}</span>;
}

function serverRender(saved: boolean | null | "none") {
	return renderToStaticMarkup(
		saved === "none" ? (
			<Probe />
		) : (
			<CompactSeed saved={saved}>
				<Probe />
			</CompactSeed>
		),
	);
}

describe("useCompact on the server", () => {
	test("renders the phone tree when the saved layout is compact", () => {
		expect(serverRender(true)).toContain("phone");
	});
	test("renders the desktop tree when the saved layout is wide", () => {
		expect(serverRender(false)).toContain("desktop");
	});
	test("renders the desktop tree when nothing is saved", () => {
		expect(serverRender(null)).toContain("desktop");
		expect(serverRender("none")).toContain("desktop");
	});
});
