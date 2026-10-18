"use client";

import { Choice } from "@/components/choice";
import { useRouter } from "next/navigation";

export type AccountSegment = "usage" | "keys";

/** The phone's Account segments, in order. Each is its own route. */
export const ACCOUNT_SEGMENTS: readonly {
	id: AccountSegment;
	label: string;
	href: string;
}[] = [
	{ id: "usage", label: "Usage", href: "/account/credits" },
	{ id: "keys", label: "Keys", href: "/account/keys" },
];

/** The segmented control without the router, so tests and the Lab render it. */
export function AccountSegments({
	current,
	onSelect,
}: {
	current: AccountSegment;
	onSelect: (segment: AccountSegment) => void;
}) {
	return (
		<div className="mac-head">
			<p className="m-sub">Pay as you go</p>
			<Choice
				name="account-segment"
				legend="Account section"
				size="sm"
				options={ACCOUNT_SEGMENTS.map((s) => ({
					value: s.id,
					label: s.label,
				}))}
				value={current}
				onChange={(value) => onSelect(value as AccountSegment)}
			/>
		</div>
	);
}

/** Under the shell's "Account" title: switches between Usage and Keys. */
export function AccountCompactHeader({ current }: { current: AccountSegment }) {
	const router = useRouter();
	return (
		<AccountSegments
			current={current}
			onSelect={(id) => {
				const next = ACCOUNT_SEGMENTS.find((s) => s.id === id);
				if (next && id !== current) router.replace(next.href);
			}}
		/>
	);
}
