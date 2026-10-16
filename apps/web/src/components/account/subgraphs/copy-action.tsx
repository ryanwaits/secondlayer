"use client";

import { copyText } from "@/lib/docs-clipboard";
import { useEffect, useRef, useState } from "react";

/** A text button that copies a string and says "Copied" for a moment. */
export function CopyAction({
	text,
	label,
	className = "sg-act",
}: {
	text: string;
	label: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	return (
		<button
			type="button"
			className={className}
			onClick={async () => {
				if (!(await copyText(text))) return;
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? "Copied" : label}
		</button>
	);
}
