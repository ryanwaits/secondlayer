/**
 * Hero art for "The data your app needs isn't in anyone's API".
 *
 * Not a figure. It has no caption, nothing is lifted from the post, and it
 * lives in the /writing feature slot (and any wide/OG crop of it).
 *
 * Register: product-marketing UI abstraction. Grayed placeholder chrome over a
 * soft gradient ground, cropped by the card edge. The argument is the one panel
 * with nothing in it.
 *
 * Composition constraints, learned the hard way: this renders at ~350px in the
 * feature card AND wide for OG, so it carries only four elements (header, two
 * filled panels, one empty) sized in container-relative units. An earlier
 * version had a sidebar and collapsed into slivers at card width.
 *
 * Motion: the two filled panels fill, staggered, then the loop rests. The empty
 * one never does, which is the whole joke. Disabled under prefers-reduced-motion.
 */
export function MissingPanel() {
	return (
		<div className="mpx">
			<div className="mpx-blob mpx-blob-a" />
			<div className="mpx-blob mpx-blob-b" />
			<div className="mpx-blob mpx-blob-c" />

			<div className="mpx-win">
				<div className="mpx-head">
					<span className="mpx-bar mpx-title" />
					<span className="mpx-chip" />
				</div>

				<div className="mpx-row">
					<div className="mpx-panel">
						<span className="mpx-bar mpx-cap" />
						<span className="mpx-fill mpx-fill-1" />
					</div>
					<div className="mpx-panel">
						<span className="mpx-bar mpx-cap" />
						<span className="mpx-fill mpx-fill-2" />
					</div>
				</div>

				<div className="mpx-void">
					<span className="mpx-void-label">Positions</span>
					<span className="mpx-void-none">no data</span>
				</div>
			</div>
		</div>
	);
}
