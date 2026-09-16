import { useEffect, useRef } from "react";

/* Landing ground texture: an engraved cross-section of stacked strata,
   hatched like a geology plate. Drawn once on the client in the theme's
   ink at low alpha, radially masked so the copy column stays clean.
   Static by design; nothing to reduce for prefers-reduced-motion. */

const W = 1400;
const H = 760;

function mulberry(seed: number) {
	let s = seed;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function inkTriplet(el: HTMLElement) {
	const c = getComputedStyle(el).getPropertyValue("--sl-ink-rgb").trim();
	return c || "28,26,22";
}

function draw(canvas: HTMLCanvasElement) {
	const g = canvas.getContext("2d");
	if (!g) return;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, W, H);

	const rgb = inkTriplet(canvas);
	const rand = mulberry(7);
	const left = 460;

	type Band = { y: number; th: number; ph: number; amp: number; f: number };
	const bands: Band[] = [];
	for (let y = 120; y < H + 40; ) {
		const th = 26 + rand() * 40;
		bands.push({
			y,
			th,
			ph: rand() * 6,
			amp: 6 + rand() * 10,
			f: 1 / (140 + rand() * 120),
		});
		y += th;
	}
	const bound = (b: Band, x: number) =>
		b.y +
		Math.sin(x * b.f * 6.28 + b.ph) * b.amp +
		Math.sin(x * b.f * 2.1 + b.ph * 1.7) * b.amp * 0.5;

	g.lineWidth = 1;
	bands.forEach((b, i) => {
		g.strokeStyle = `rgba(${rgb},0.16)`;
		g.beginPath();
		for (let x = left; x <= W; x += 4) {
			const yy = bound(b, x);
			if (x === left) g.moveTo(x, yy);
			else g.lineTo(x, yy);
		}
		g.stroke();

		const dense = i % 3 === 0 ? 5 : i % 3 === 1 ? 9 : 14;
		const slant = i % 2 ? 0.5 : -0.5;
		g.strokeStyle = `rgba(${rgb},0.09)`;
		for (let x0 = left; x0 < W + 60; x0 += dense) {
			g.beginPath();
			g.moveTo(x0, bound(b, x0) + 2);
			g.lineTo(x0 + slant * b.th, bound(b, x0) + b.th - 2);
			g.stroke();
		}
	});

	g.globalCompositeOperation = "destination-in";
	const radial = g.createRadialGradient(1040, 300, 80, 1040, 300, 820);
	radial.addColorStop(0, "rgba(0,0,0,1)");
	radial.addColorStop(0.55, "rgba(0,0,0,0.7)");
	radial.addColorStop(1, "rgba(0,0,0,0)");
	g.fillStyle = radial;
	g.fillRect(0, 0, W, H);

	g.globalCompositeOperation = "destination-out";
	const fade = g.createLinearGradient(0, 0, 640, 0);
	fade.addColorStop(0, "rgba(0,0,0,1)");
	fade.addColorStop(1, "rgba(0,0,0,0)");
	g.fillStyle = fade;
	g.fillRect(0, 0, 640, H);
	const fadeRight = g.createLinearGradient(W - 240, 0, W, 0);
	fadeRight.addColorStop(0, "rgba(0,0,0,0)");
	fadeRight.addColorStop(1, "rgba(0,0,0,1)");
	g.fillStyle = fadeRight;
	g.fillRect(W - 240, 0, 240, H);
	const fadeBottom = g.createLinearGradient(0, H - 280, 0, H);
	fadeBottom.addColorStop(0, "rgba(0,0,0,0)");
	fadeBottom.addColorStop(1, "rgba(0,0,0,1)");
	g.fillStyle = fadeBottom;
	g.fillRect(0, H - 280, W, 280);
	g.globalCompositeOperation = "source-over";
}

export function Strata() {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		draw(canvas);
		/* Theme is the `dark` class on <html> (set from the OS by Vocs's
		   initializeTheme script); redraw whenever it flips. */
		const redraw = () => draw(canvas);
		const observer = new MutationObserver(redraw);
		observer.observe(document.documentElement, {
			attributeFilter: ["class"],
			attributes: true,
		});
		return () => observer.disconnect();
	}, []);
	return (
		<div aria-hidden="true" className="sl-strata">
			<canvas height={H} ref={ref} width={W} />
		</div>
	);
}
