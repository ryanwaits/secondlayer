/**
 * The one HTML/text layout every customer email renders through, in the
 * brand's "Figure" look: logo + wordmark, a 24px heading, muted prose, the
 * code or facts inside a hairline code figure whose bar names it and carries
 * a status chip, one blue button, and a hairline footer.
 *
 * Table-based HTML with inline styles (most clients strip <style>). The head
 * <style> only adds dark mode for clients that honor `prefers-color-scheme`
 * (Apple Mail, iOS); everyone else gets the light palette, which Gmail
 * inverts on its own. Geist loads where web fonts work, the system stack
 * elsewhere. Callers pass content; every color lives here.
 */

export interface FactRow {
	label: string;
	value: string;
}

export interface EmailCta {
	label: string;
	url: string;
}

/** `alarm` only for failures and stops, `ok` only for success. */
export type EmailTone = "neutral" | "ok" | "alarm";

export interface EmailStatus {
	tone: EmailTone;
	text: string;
}

export interface RenderEmailInput {
	heading: string;
	/** The inbox preview line after the subject. Not shown in the body. */
	preheader?: string;
	paragraphs: string[];
	/** Someone else's words, quoted (a contact form message). */
	quote?: string;
	/** A sign-in code, shown as one selectable run of digits in the figure. */
	code?: string;
	facts?: FactRow[];
	/** The figure's title bar. Defaults to "sign-in code" or "details". */
	figure?: string;
	/** A chip in the figure bar, or a status line when there is no figure. */
	status?: EmailStatus;
	cta?: EmailCta;
	/** Why the reader got this email and how to stop it. */
	footnote?: string;
}

export interface RenderedEmail {
	html: string;
	text: string;
}

// www directly: the apex 307s there, and every image fetch would pay for it.
const LOGO_URL = "https://www.secondlayer.tools/email/logo.png";
const TAGLINE = "Instant data for apps on Bitcoin";

const SANS =
	"Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO =
	"'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// DESIGN.md roles. Light inline; dark via the head <style> classes below.
const LIGHT = {
	paper: "#ffffff",
	ink: "#111111",
	sub: "#5e5e5e",
	faint: "#9b9b96",
	line: "#e5e5e2",
	pri: "#1f45e0",
	onPri: "#ffffff",
	ok: "#128a43",
	alarm: "#e3301e",
};

const DARK_STYLE = `
@media (prefers-color-scheme: dark) {
  .sl-paper { background: #1c1b19 !important; }
  .sl-ink { color: #ece9e2 !important; }
  .sl-sub { color: #b0aca2 !important; }
  .sl-faint { color: #7c786f !important; }
  .sl-line { border-color: #383631 !important; }
  .sl-pri { background: #3a5bff !important; }
  .sl-ok { color: #5cc28f !important; }
  .sl-alarm { color: #ff5a47 !important; }
  .sl-dot-neutral { background: #7c786f !important; }
  .sl-dot-ok { background: #5cc28f !important; }
  .sl-dot-alarm { background: #ff5a47 !important; }
}`.trim();

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const TONE_COLOR: Record<EmailTone, string> = {
	neutral: LIGHT.sub,
	ok: LIGHT.ok,
	alarm: LIGHT.alarm,
};
const DOT_COLOR: Record<EmailTone, string> = {
	neutral: LIGHT.faint,
	ok: LIGHT.ok,
	alarm: LIGHT.alarm,
};
const TONE_CLASS: Record<EmailTone, string> = {
	neutral: "sl-sub",
	ok: "sl-ok",
	alarm: "sl-alarm",
};

function dot(tone: EmailTone): string {
	return `<span class="sl-dot-${tone}" style="display: inline-block; width: 7px; height: 7px; border-radius: 999px; background: ${DOT_COLOR[tone]}; margin-right: 6px; vertical-align: 1px;"></span>`;
}

function statusChip(status: EmailStatus): string {
	return `<span class="sl-line ${TONE_CLASS[status.tone]}" style="display: inline-block; border: 1px solid ${LIGHT.line}; border-radius: 999px; padding: 2px 8px; font-family: ${MONO}; font-size: 12px; line-height: 16px; color: ${TONE_COLOR[status.tone]}; white-space: nowrap;">${dot(status.tone)}${escapeHtml(status.text)}</span>`;
}

function preheaderHtml(preheader: string | undefined): string {
	if (!preheader) return "";
	// Trailing joiners keep body text from leaking into the preview line.
	const filler = "&#847;&zwnj;&nbsp;".repeat(60);
	return `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; opacity: 0; color: transparent;">${escapeHtml(preheader)}${filler}</div>`;
}

function figureHtml(input: RenderEmailInput): string {
	if (!input.code && !input.facts?.length) return "";
	const title = input.figure ?? (input.code ? "sign-in code" : "details");
	const line = `border-color: ${LIGHT.line}; border-style: solid; border-width: 0`;

	const bar = `<tr>
      <td class="sl-faint sl-line" style="padding: 8px 14px; ${line}; border-bottom-width: 1px; font-family: ${MONO}; font-size: 12px; line-height: 18px; color: ${LIGHT.faint};">${escapeHtml(title)}</td>
      <td class="sl-line" align="right" style="padding: 8px 14px; ${line}; border-bottom-width: 1px;">${input.status ? statusChip(input.status) : ""}</td>
    </tr>`;

	let body: string;
	if (input.code) {
		body = `<tr><td colspan="2" align="center" class="sl-ink" style="padding: 24px 14px 8px; font-family: ${MONO}; font-size: 36px; line-height: 40px; font-weight: 500; letter-spacing: 0.3em; color: ${LIGHT.ink}; -webkit-user-select: all; user-select: all;">${escapeHtml(input.code)}</td></tr>
    <tr><td colspan="2" align="center" class="sl-faint" style="padding: 0 14px 16px; font-family: ${MONO}; font-size: 12px; line-height: 18px; color: ${LIGHT.faint};">tap or double-click to select</td></tr>`;
	} else {
		const facts = input.facts ?? [];
		body = facts
			.map((fact, i) => {
				const top = i === 0 ? 12 : 2;
				const bottom = i === facts.length - 1 ? 12 : 2;
				const cell = `padding: ${top}px 14px ${bottom}px; font-family: ${MONO}; font-size: 13px; line-height: 20px; vertical-align: top;`;
				return `<tr>
      <td class="sl-faint" style="${cell} padding-right: 24px; width: 1%; color: ${LIGHT.faint}; white-space: nowrap;">${escapeHtml(fact.label.toLowerCase())}</td>
      <td class="sl-ink" style="${cell} color: ${LIGHT.ink}; word-break: break-word;">${escapeHtml(fact.value)}</td>
    </tr>`;
			})
			.join("\n    ");
	}

	return `<table role="presentation" cellpadding="0" cellspacing="0" class="sl-line" style="width: 100%; border: 1px solid ${LIGHT.line}; border-radius: 8px; border-collapse: separate; border-spacing: 0; margin: 8px 0 24px;">
    ${bar}
    ${body}
  </table>`;
}

function renderHtml(input: RenderEmailInput): string {
	const hasFigure = Boolean(input.code || input.facts?.length);

	const statusLine =
		input.status && !hasFigure
			? `<p class="${TONE_CLASS[input.status.tone]}" style="margin: 0 0 12px; font-size: 13px; line-height: 20px; color: ${TONE_COLOR[input.status.tone]};">${dot(input.status.tone)}${escapeHtml(input.status.text)}</p>`
			: "";

	const paragraphsHtml = input.paragraphs
		.map(
			(p) =>
				`<p class="sl-sub" style="margin: 0 0 14px; font-size: 15px; line-height: 24px; color: ${LIGHT.sub};">${escapeHtml(p)}</p>`,
		)
		.join("\n            ");

	const quoteHtml = input.quote
		? `<p class="sl-ink" style="margin: 0 0 14px; font-size: 15px; line-height: 24px; color: ${LIGHT.ink};">&ldquo;${escapeHtml(input.quote)}&rdquo;</p>`
		: "";

	const ctaHtml = input.cta
		? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 10px 0 0;"><tr><td class="sl-pri" style="background: ${LIGHT.pri}; border-radius: 4px;"><a href="${escapeHtml(input.cta.url)}" style="display: inline-block; padding: 0 18px; height: 42px; line-height: 42px; font-family: ${SANS}; font-size: 15px; font-weight: 500; color: ${LIGHT.onPri}; text-decoration: none;">${escapeHtml(input.cta.label)}</a></td></tr></table>`
		: "";

	const footnoteHtml = input.footnote
		? `<p class="sl-faint" style="margin: 0 0 6px;">${escapeHtml(input.footnote)}</p>`
		: "";

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&display=swap">
<style>
${DARK_STYLE}
</style>
</head>
<body class="sl-paper" style="margin: 0; padding: 0; background: ${LIGHT.paper};">
${preheaderHtml(input.preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" class="sl-paper" style="width: 100%; background: ${LIGHT.paper};">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px; font-family: ${SANS}; padding: 40px 20px;">
        <tr>
          <td>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 32px;"><tr>
              <td style="padding-right: 8px; vertical-align: middle;"><img src="${LOGO_URL}" width="30" height="20" alt="" style="display: block; border: 0;"></td>
              <td class="sl-ink" style="vertical-align: middle; font-size: 15px; font-weight: 500; letter-spacing: -0.01em; color: ${LIGHT.ink};">secondlayer</td>
            </tr></table>
            ${statusLine}
            <h1 class="sl-ink" style="margin: 0 0 14px; font-size: 24px; line-height: 29px; font-weight: 500; letter-spacing: -0.025em; color: ${LIGHT.ink};">${escapeHtml(input.heading)}</h1>
            ${paragraphsHtml}
            ${quoteHtml}
            ${figureHtml(input)}
            ${ctaHtml}
            <div class="sl-line sl-faint" style="margin: 32px 0 0; padding: 16px 0 0; border-top: 1px solid ${LIGHT.line}; font-size: 12px; line-height: 18px; color: ${LIGHT.faint};">
              ${footnoteHtml}
              <p class="sl-faint" style="margin: 0;"><span class="sl-sub" style="color: ${LIGHT.sub}; font-weight: 500;">Secondlayer</span> &middot; ${TAGLINE}</p>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderText(input: RenderEmailInput): string {
	const lines: string[] = [input.heading, ""];
	for (const p of input.paragraphs) lines.push(p, "");
	if (input.quote) lines.push(`"${input.quote}"`, "");
	if (input.status) lines.push(input.status.text, "");
	if (input.code) lines.push(`Code: ${input.code}`, "");
	if (input.facts?.length) {
		for (const fact of input.facts) lines.push(`${fact.label}: ${fact.value}`);
		lines.push("");
	}
	if (input.cta) lines.push(`${input.cta.label}: ${input.cta.url}`, "");
	lines.push("--");
	if (input.footnote) lines.push(input.footnote);
	lines.push(`Secondlayer · ${TAGLINE}`);
	return lines.join("\n");
}

export function renderEmail(input: RenderEmailInput): RenderedEmail {
	return { html: renderHtml(input), text: renderText(input) };
}
