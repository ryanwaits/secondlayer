"use client";

import { useCallback, useRef, useState } from "react";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	placeholder?: string;
}

export function ChatInput({
	onSend,
	disabled = false,
	placeholder = "Message secondlayer...",
}: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const resize = useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, []);

	function handleSubmit() {
		const text = value.trim();
		if (!text || disabled) return;
		onSend(text);
		setValue("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}

	const hasContent = value.trim().length > 0;

	return (
		<div className="input-dock">
			<div className={`input-card ${disabled ? "disabled" : ""}`}>
				<div className="input-textarea-wrap">
					<textarea
						ref={textareaRef}
						className="input-textarea"
						placeholder={placeholder}
						value={value}
						rows={1}
						onChange={(e) => {
							setValue(e.target.value);
							resize();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						disabled={disabled}
					/>
				</div>
				<div className="input-footer">
					<div className="input-actions">
						<button
							type="button"
							className={`input-submit ${hasContent ? "visible" : ""}`}
							onClick={handleSubmit}
							disabled={disabled || !hasContent}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M3 8h10M10 5l3 3-3 3" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
