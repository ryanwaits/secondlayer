import { z } from "zod/v4";

export const TxStatusProps = z.object({
	status: z.enum([
		"pending",
		"success",
		"failed",
		"abort_by_post_condition",
		"abort_by_response",
	]),
	txId: z.string().nullable().optional(),
});

export type TxStatusPropsType = z.infer<typeof TxStatusProps>;

const TONE: Record<TxStatusPropsType["status"], string> = {
	pending:
		"bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
	success: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
	failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
	abort_by_post_condition:
		"bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
	abort_by_response:
		"bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

const LABEL: Record<TxStatusPropsType["status"], string> = {
	pending: "pending",
	success: "confirmed",
	failed: "failed",
	abort_by_post_condition: "post-condition aborted",
	abort_by_response: "aborted",
};

export function TxStatus(props: TxStatusPropsType) {
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[props.status]}`}
			title={props.txId ?? undefined}
		>
			{LABEL[props.status]}
		</span>
	);
}

export const TxStatusComponent = {
	props: TxStatusProps,
	render: TxStatus,
} as const;
