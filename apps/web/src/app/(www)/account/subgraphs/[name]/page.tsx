"use client";

import { SubgraphDetailSection } from "@/components/account/subgraphs/detail-screen";
import { useParams } from "next/navigation";

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

export default function AccountSubgraphDetailPage() {
	const params = useParams<{ name: string }>();
	const raw = Array.isArray(params.name) ? params.name[0] : params.name;
	if (!raw) return null;
	return <SubgraphDetailSection name={decode(raw)} />;
}
