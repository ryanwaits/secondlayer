"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface OpenInChatProps {
	workflowName: string;
}

export function OpenInChat({ workflowName }: OpenInChatProps) {
	const router = useRouter();

	const handleClick = useCallback(() => {
		const id = crypto.randomUUID();
		const prompt = `Read the workflow "${workflowName}" and show me its source so I can edit it.`;
		router.push(`/sessions/${id}?q=${encodeURIComponent(prompt)}`);
	}, [router, workflowName]);

	return (
		<button type="button" className="tool-btn ghost" onClick={handleClick}>
			Open in chat
		</button>
	);
}
