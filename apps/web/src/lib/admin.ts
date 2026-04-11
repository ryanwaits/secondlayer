const ADMIN_EMAILS = ["ryan.waits@gmail.com"];

export function isAdmin(email: string): boolean {
	return ADMIN_EMAILS.includes(email);
}
