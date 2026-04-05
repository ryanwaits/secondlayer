"use client";

import { useRef, useState } from "react";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	placeholder?: string;
}

export function ChatInput({
	onSend,
	disabled = false,
	placeholder = "Ask a follow-up question...",
}: ChatInputProps) {
	const [value, setValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	function handleSubmit() {
		const text = value.trim();
		if (!text || disabled) return;
		onSend(text);
		setValue("");
	}

	return (
		<div className="session-bottom-input">
			<div className="session-input-inner">
				<input
					ref={inputRef}
					type="text"
					className="session-input"
					placeholder={placeholder}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}
