import { isDevMode } from "../lib/dev-mode.ts";

const FROM =
	process.env.EMAIL_FROM ?? "secondlayer <noreply@secondlayer.tools>";

function getResendKey(): string {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) throw new Error("RESEND_API_KEY not configured");
	return apiKey;
}

async function sendEmail(
	to: string,
	subject: string,
	text: string,
	html: string,
): Promise<void> {
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${getResendKey()}`,
		},
		body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Resend API error (${response.status}): ${body}`);
	}
}

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

	const text = [
		`Your login code: ${code}`,
		"",
		`Or sign in directly: ${verifyUrl}`,
		"",
		"This expires in 15 minutes.",
		"",
		"If you didn't request this, you can safely ignore this email.",
	].join("\n");

	const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <p style="color: #888; font-size: 14px; margin: 0 0 24px;">secondlayer</p>
  <p style="color: #555; font-size: 14px; margin: 0 0 16px;">Your login code:</p>
  <div style="background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
    <span style="font-size: 32px; font-weight: 600; letter-spacing: 8px; color: #111;">${code}</span>
  </div>
  <p style="color: #555; font-size: 14px; margin: 0 0 16px;">Or click below to sign in directly:</p>
  <a href="${verifyUrl}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">Sign in to secondlayer</a>
  <p style="color: #aaa; font-size: 12px; margin: 24px 0 0;">This expires in 15 minutes. If you didn't request this, ignore this email.</p>
</div>`.trim();

	await sendEmail(email, "Your secondlayer login code", text, html);
}
