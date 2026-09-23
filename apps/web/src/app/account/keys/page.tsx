"use client";

import { KeysSection } from "@/components/account/keys-panel";
import { takeHandedOverKey } from "@/lib/new-key";
import { useEffect, useRef, useState } from "react";

export default function AccountKeysPage() {
	// Sign-in (or the card's expand) hands a new key over to show here, once.
	// Taking it clears it, so guard against effects running twice.
	const [handedOver, setHandedOver] = useState<string | null>(null);
	const taken = useRef(false);
	useEffect(() => {
		if (taken.current) return;
		taken.current = true;
		setHandedOver(takeHandedOverKey());
	}, []);

	return (
		<>
			<h1 className="acct-h1">API keys</h1>
			<p className="acct-lede">
				A key reads the hosted API. Send it as{" "}
				<code>Authorization: Bearer</code>.
			</p>
			<KeysSection handedOver={handedOver} />
		</>
	);
}
