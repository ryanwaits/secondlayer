/**
 * Magic link email service. Uses Resend in production, logs to console in DEV_MODE.
 */
export async function sendMagicLink(email: string, token: string): Promise<void> {
  if (process.env.DEV_MODE === "true") {
    console.log(`\n[DEV] Magic link token for ${email}: ${token}\n`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const webUrl = process.env.WEB_URL ?? "https://secondlayer.tools";
  const verifyUrl = `${webUrl}/verify?token=${token}`;

  const from = process.env.EMAIL_FROM ?? "Second Layer <noreply@secondlayer.tools>";

  const text = [
    `Your login code is: ${token}`,
    "",
    `Or sign in directly: ${verifyUrl}`,
    "",
    "This code expires in 15 minutes.",
    "",
    "If you didn't request this, you can safely ignore this email.",
  ].join("\n");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <p style="color: #888; font-size: 14px; margin: 0 0 24px;">Sign in to Second Layer</p>
  <div style="background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
    <p style="color: #888; font-size: 13px; margin: 0 0 8px;">Your login code</p>
    <p style="font-size: 32px; font-weight: 600; letter-spacing: 6px; margin: 0; color: #111;">${token}</p>
  </div>
  <p style="color: #888; font-size: 13px; margin: 0 0 16px;">Or click below to sign in directly:</p>
  <a href="${verifyUrl}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">Sign in to Second Layer</a>
  <p style="color: #aaa; font-size: 12px; margin: 24px 0 0;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
</div>`.trim();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Second Layer login code",
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }
}
