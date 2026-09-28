import { renderEmail, sendEmail } from "@secondlayer/shared/email";
import { isDevMode } from "../lib/dev-mode.ts";

/**
 * Magic link email service. Uses Resend in production, logs to console in DEV_MODE.
 */
export async function sendMagicLink(
	email: string,
	token: string,
	code: string,
): Promise<void> {
	if (isDevMode()) {
		console.log(`\n[DEV] Magic link token for ${email}: ${token}`);
		console.log(`[DEV] Code: ${code}\n`);
		return;
	}

	const webUrl = process.env.WEB_URL ?? "https://secondlayer.tools";
	const verifyUrl = `${webUrl}/verify?token=${token}`;

	const { html, text } = renderEmail({
		heading: "Your login code",
		paragraphs: ["Or click below to sign in directly:"],
		code,
		cta: { label: "Sign in to secondlayer", url: verifyUrl },
		footnote:
			"This expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
	});

	await sendEmail({
		to: email,
		subject: "Your secondlayer login code",
		html,
		text,
	});
}
