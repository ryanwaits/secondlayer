/**
 * The one HTML/text layout every customer email renders through. Table-based
 * HTML, inline styles only (email clients strip <style>), 560px max width,
 * white background, #111 text, one black button — same look as the login
 * email this was lifted from. Text is the same content, plainer.
 */

export interface FactRow {
	label: string;
	value: string;
}

export interface EmailCta {
	label: string;
	url: string;
}

export interface RenderEmailInput {
	heading: string;
	paragraphs: string[];
	/** A code shown in a large, letter-spaced box (login codes). */
	code?: string;
	facts?: FactRow[];
	cta?: EmailCta;
	footnote?: string;
}

export interface RenderedEmail {
	html: string;
	text: string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderHtml(input: RenderEmailInput): string {
	const paragraphsHtml = input.paragraphs
		.map(
			(p) =>
				`<p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${escapeHtml(p)}</p>`,
		)
		.join("\n  ");

	const codeHtml = input.code
		? `<div style="background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
    <span style="font-size: 32px; font-weight: 600; letter-spacing: 8px; color: #111;">${escapeHtml(input.code)}</span>
  </div>`
		: "";

	const factsHtml = input.facts?.length
		? `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 0 0 24px; border-collapse: collapse;">
    ${input.facts
			.map(
				(fact) =>
					`<tr><td style="padding: 6px 0; color: #888; font-size: 13px;">${escapeHtml(fact.label)}</td><td style="padding: 6px 0; color: #111; font-size: 13px; text-align: right; font-weight: 600;">${escapeHtml(fact.value)}</td></tr>`,
			)
			.join("\n    ")}
  </table>`
		: "";

	const ctaHtml = input.cta
		? `<a href="${escapeHtml(input.cta.url)}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; margin: 0 0 24px;">${escapeHtml(input.cta.label)}</a>`
		: "";

	const footnoteHtml = input.footnote
		? `<p style="color: #aaa; font-size: 12px; margin: 24px 0 0;">${escapeHtml(input.footnote)}</p>`
		: "";

	return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background: #fff;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 560px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px;">
        <tr>
          <td>
            <p style="color: #888; font-size: 14px; margin: 0 0 24px;">secondlayer</p>
            <p style="color: #111; font-size: 18px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(input.heading)}</p>
            ${paragraphsHtml}
            ${codeHtml}
            ${factsHtml}
            ${ctaHtml}
            ${footnoteHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

function renderText(input: RenderEmailInput): string {
	const lines: string[] = [input.heading, ""];
	for (const p of input.paragraphs) lines.push(p, "");
	if (input.code) {
		lines.push(`Code: ${input.code}`, "");
	}
	if (input.facts?.length) {
		for (const fact of input.facts) lines.push(`${fact.label}: ${fact.value}`);
		lines.push("");
	}
	if (input.cta) {
		lines.push(`${input.cta.label}: ${input.cta.url}`, "");
	}
	if (input.footnote) {
		lines.push(input.footnote);
	}
	// Trim trailing blank lines.
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	return lines.join("\n");
}

export function renderEmail(input: RenderEmailInput): RenderedEmail {
	return { html: renderHtml(input), text: renderText(input) };
}
