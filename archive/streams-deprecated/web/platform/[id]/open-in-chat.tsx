"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface OpenInChatProps {
	streamId: string;
	streamName: string;
}

export function OpenInChat({ streamId, streamName }: OpenInChatProps) {
	const router = useRouter();

	const handleClick = useCallback(() => {
		const id = crypto.randomUUID();
		const prompt = `Read stream "${streamName}" (id ${streamId}) and show me its current config.`;
		router.push(`/sessions/${id}?q=${encodeURIComponent(prompt)}`);
	}, [router, streamId, streamName]);

	return (
		<button type="button" className="tool-btn ghost" onClick={handleClick}>
			Open in chat
		</button>
	);
}
