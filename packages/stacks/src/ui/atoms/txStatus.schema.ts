import { z } from "zod";

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
