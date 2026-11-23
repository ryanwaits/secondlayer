import type { Account } from "./types";

export function accountLabel(account: Pick<Account, "id" | "email">): string {
	return account.email ?? account.id;
}
