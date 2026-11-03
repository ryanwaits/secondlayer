// Not a client module: the trigger describer runs on the server too.

/** "SP21YTS…8XEF.pox4-fast-pool-v3" — long enough to recognize, short enough
 *  to sit in a table cell. Only the address part is truncated. Works for any
 *  long identifier (a transaction id has no dot, so it's truncated whole). */
export function shortenPrincipal(value: string): string {
	const dot = value.indexOf(".");
	const addr = dot > 0 ? value.slice(0, dot) : value;
	const shortAddr =
		addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
	return dot > 0 ? `${shortAddr}${value.slice(dot)}` : shortAddr;
}
