import { z } from "zod";

export interface TxStatusPropsType {
	status:
		| "pending"
		| "success"
		| "failed"
		| "abort_by_post_condition"
		| "abort_by_response";
	txId?: string | null | undefined;
}

export const TxStatusProps: z.ZodTypeAny = z.object({
	status: z.enum([
		"pending",
		"success",
		"failed",
		"abort_by_post_condition",
		"abort_by_response",
	]),
	txId: z.string().nullable().optional(),
});
