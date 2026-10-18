/* The app icon: the mark on a paper square. Light colors only; an installed icon has no color scheme. */
const MARK = [
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
	'<polygon points="8,23 28,15 40,23 20,31" fill="#111111" opacity="0.24"/>',
	'<polygon points="8,19 28,11 40,19 20,27" fill="#1f45e0"/>',
	"</svg>",
].join("");

export function drawIcon(size: number) {
	const mark = Math.round(size * 0.62);
	return (
		<div
			style={{
				width: size,
				height: size,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#ffffff",
			}}
		>
			<img
				alt=""
				width={mark}
				height={mark}
				src={`data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`}
			/>
		</div>
	);
}
