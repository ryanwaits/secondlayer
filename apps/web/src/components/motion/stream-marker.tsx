"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { shouldEndStreamed } from "./streamed";

/**
 * Rendered inside a Suspense fallback. Its inline script runs while the
 * browser parses the server HTML, and only when the fallback was actually sent
 * (a page whose data landed inside the head start sends none), and sets
 * `data-streamed` on <html>. The region that replaces the fallback then fades
 * in. A client-side navigation renders this without running the script, so tab
 * changes never fade. The first click or key ends it, so polls and refreshes
 * after that stay still.
 *
 * It is a script, not a mount effect, because streamed HTML is visible before
 * React hydrates it: an effect would start the fade after the content showed.
 */
const SCRIPT = `(function(d){d.setAttribute("data-streamed","");function end(){d.removeAttribute("data-streamed");removeEventListener("pointerdown",end,true);removeEventListener("keydown",end,true)}addEventListener("pointerdown",end,true);addEventListener("keydown",end,true)})(document.documentElement)`;

export function StreamMarker() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string with no input
	return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

/** Ends the fade when the visitor moves to another page of the route. */
export function StreamedReset() {
	const pathname = usePathname();
	const first = useRef(pathname);
	useEffect(() => {
		if (shouldEndStreamed(first.current, pathname)) {
			document.documentElement.removeAttribute("data-streamed");
		}
	}, [pathname]);
	return null;
}
