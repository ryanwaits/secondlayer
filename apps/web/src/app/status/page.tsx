import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { readIncidentHeading } from "@/lib/status-page";
import { StatusPageView } from "./status-page-view";

export const metadata: Metadata = {
	title: "Status | secondlayer",
	description: "Public status for Second Layer Stacks Streams.",
};

function readIncidentFile(): string {
	const candidates = [
		join(process.cwd(), "docs/incidents/INCIDENTS.md"),
		join(process.cwd(), "../../docs/incidents/INCIDENTS.md"),
	];
	const file = candidates.find((candidate) => existsSync(candidate));
	if (!file) return "## No active incidents";
	return readFileSync(file, "utf8");
}

export default function StatusPage() {
	const incidentHeading = readIncidentHeading(readIncidentFile());
	return <StatusPageView incidentHeading={incidentHeading} />;
}
