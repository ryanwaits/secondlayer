import { highlight } from "@/lib/highlight";

/**
 * Hero art for "The data your app needs isn't in anyone's API".
 *
 * Not a figure: no caption, nothing lifted from the post. It lives in the
 * /writing feature slot and any wide crop of it.
 *
 * The argument, drawn: a real Clarity contract emits a real print event, and
 * the line beneath says nobody indexes it. Real contract source rather than
 * abstracted UI bars, because the reader is a developer and the code IS the
 * thing they recognize.
 *
 * Highlighted by the site's own Shiki pipeline (`lib/highlight`, which already
 * registers `clarity`), so the colors match every docs code block. Hand-rolled
 * spans would have drifted from the docs on the first theme change.
 *
 * Static, neutral shell dots, no marker rail.
 */
/**
 * Closing parens are broken onto their own lines and aligned under their
 * opener rather than stacked `)))` at the end. Idiomatic Clarity stacks them;
 * at hero size the stack reads as a typo, and the aligned form lets the eye
 * match each block at a glance.
 */
const SOURCE = `(define-public (deposit (amount uint))
  (begin
    (try! (stx-transfer? amount tx-sender pool))
    (print { topic: "deposit", who: tx-sender })
    (ok true)
  )
)`;

export async function MissingPanel() {
	const html = await highlight(SOURCE, "clarity");

	return (
		<div className="mpx">
			<div className="mpx-win">
				<div className="mpx-bar">
					<span className="mpx-dots">
						<i />
						<i />
						<i />
					</span>
					<span className="mpx-path">pool.clar</span>
					<span className="mpx-meta">clarity</span>
				</div>

				<div
					className="mpx-code"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki-highlighted server-rendered HTML, same pipeline as docs code blocks
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</div>
		</div>
	);
}
