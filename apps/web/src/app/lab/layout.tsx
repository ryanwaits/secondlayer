import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { labEnabled } from "./enabled";
import "../(www)/docs/docs.css";
import "../(www)/site.css";
import "../robinhood/robinhood.css";
import "./lab.css";

export const metadata: Metadata = {
	title: "Lab",
	robots: { index: false, follow: false },
};

export default function LabLayout({ children }: { children: ReactNode }) {
	if (!labEnabled()) notFound();
	return children;
}
