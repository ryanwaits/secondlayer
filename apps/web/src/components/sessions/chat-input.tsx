"use client";

import { useCallback, useRef, useState } from "react";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
	placeholder?: string;
	variant?: "welcome" | "session";
}

export function ChatInput({
	onSend,
	disabled = false,
	placeholder = "Message secondlayer...",
	variant = "session",
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
	const isWelcome = variant === "welcome";

	return (
		<div className={`input-dock ${isWelcome ? "input-dock-welcome" : ""}`}>
			<div
				className={`input-card ${isWelcome ? "input-card-welcome" : "input-card-session"} ${disabled ? "disabled" : ""}`}
			>
				{isWelcome ? (
					/* Welcome: tall card with textarea */
					<>
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
								{hasContent ? (
									<button
										type="button"
										className="input-submit visible"
										onClick={handleSubmit}
										disabled={disabled}
									>
										<ArrowUpIcon />
									</button>
								) : (
									<button type="button" className="input-mic" disabled>
										<MicIcon />
									</button>
								)}
							</div>
						</div>
					</>
				) : (
					/* Session: thin pill with inline input */
					<div className="input-pill-row">
						<textarea
							ref={textareaRef}
							className="input-pill-textarea"
							placeholder="Send follow-up..."
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
						{hasContent ? (
							<button
								type="button"
								className="input-submit visible"
								onClick={handleSubmit}
								disabled={disabled}
							>
								<ArrowUpIcon />
							</button>
						) : (
							<button type="button" className="input-mic" disabled>
								<MicIcon />
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function ArrowUpIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M8 13V3M4 7l4-4 4 4" />
		</svg>
	);
}

function MicIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="5" y="1" width="6" height="9" rx="3" />
			<path d="M3 7a5 5 0 0010 0" />
			<path d="M8 12v3" />
		</svg>
	);
}
