import type { Account } from "./types";

/** How an account is named where a person is: its email, else its id (a ghost
 *  account has no email). */
export function accountLabel(account: Pick<Account, "id" | "email">): string {
	return account.email ?? account.id;
}
