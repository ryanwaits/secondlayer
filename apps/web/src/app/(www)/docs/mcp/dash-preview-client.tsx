"use client";

import { useEffect, useRef } from "react";
import {
	type Catalog,
	type Spec,
	render,
} from "../../../../../../../skills/secondlayer/dash/template/kit.js";
import { demoFetch } from "./dash-demo";

/** Mounts the real kit on the example account, in a shadow root so docs
 *  styles never reach it. It polls `demoFetch` like it polls the local proxy,
 *  and stops when the preview unmounts. */
export function DashPreviewClient({
	css,
	spec,
	catalog,
}: {
	css: string;
	spec: Spec;
	catalog: Catalog;
}) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = css;
		const main = document.createElement("main");
		shadow.replaceChildren(style, main);
		return render(spec, main, {
			catalog,
			fetch: demoFetch,
			host: "localhost:4400",
		});
	}, [css, spec, catalog]);
	return <div ref={host} />;
}
