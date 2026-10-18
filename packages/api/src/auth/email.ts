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
	const verifyUrl = `${webUrl}/auth/verify?token=${token}`;

	const { html, text } = renderEmail({
		heading: "Your sign-in code",
		preheader: "Expires in 15 minutes.",
		paragraphs: [
			"Enter this code where you started signing in, or use the button.",
		],
		code,
		status: { tone: "neutral", text: "Expires in 15 minutes" },
		cta: { label: "Sign in to secondlayer", url: verifyUrl },
		footnote:
			"Didn't ask to sign in? Ignore this email. Nobody gets in without this code or link.",
	});

	// Code first so it reads from the notification without opening the email.
	await sendEmail({
		to: email,
		subject: `${code} is your secondlayer sign-in code`,
		html,
		text,
	});
}
