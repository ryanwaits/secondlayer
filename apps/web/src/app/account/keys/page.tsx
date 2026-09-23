"use client";

import { KeysSection } from "@/components/account/keys-panel";
import { takeHandedOverKey } from "@/lib/new-key";
import { useEffect, useState } from "react";

export default function AccountKeysPage() {
	// Sign-in mints a first key and hands it over to show here, once.
	const [handedOver, setHandedOver] = useState<string | null>(null);
	useEffect(() => setHandedOver(takeHandedOverKey()), []);

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
