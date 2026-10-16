"use client";

import { KeysScreen } from "@/components/account/keys/keys-screen";
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

	return <KeysScreen handedOver={handedOver} />;
}
