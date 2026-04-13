"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface OpenInChatProps {
	subgraphName: string;
}

export function OpenInChat({ subgraphName }: OpenInChatProps) {
	const router = useRouter();

	const handleClick = useCallback(() => {
		const id = crypto.randomUUID();
		const prompt = `Read the subgraph "${subgraphName}" and show me its source so I can edit it.`;
		router.push(`/sessions/${id}?q=${encodeURIComponent(prompt)}`);
	}, [router, subgraphName]);

	return (
		<button type="button" className="tool-btn ghost" onClick={handleClick}>
			Open in chat
		</button>
	);
}
