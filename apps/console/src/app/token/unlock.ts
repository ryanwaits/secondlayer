"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function unlock(formData: FormData) {
	const expected =
		process.env.CONSOLE_TOKEN || process.env.INSTANCE_TOKEN || "";
	const token = String(formData.get("token") ?? "");
	const next = String(formData.get("next") ?? "/");
	// Only same-app paths — never an absolute URL from form data.
	const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/";
	if (!expected || token !== expected) {
		redirect(`/token?error=1&next=${encodeURIComponent(dest)}`);
	}
	const jar = await cookies();
	jar.set("sl_console", token, {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});
	redirect(dest);
}
