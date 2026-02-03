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

  const from = process.env.EMAIL_FROM ?? "Second Layer <noreply@secondlayer.tools>";
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
      text: [
        `Your login token: ${token}`,
        "",
        "Paste this token in your CLI to complete login.",
        "This token expires in 15 minutes.",
        "",
        "If you didn't request this, you can safely ignore this email.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }
}
