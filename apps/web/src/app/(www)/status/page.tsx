import type { Metadata } from "next";
import { StatusPageView } from "./status-page-view";

export const metadata: Metadata = {
	title: "Status | secondlayer",
	description: "Public status: Streams API, Index, and decoder health.",
};

export default function StatusPage() {
	return <StatusPageView />;
}
