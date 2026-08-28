/**
 * The archive signing key, compiled into every release.
 *
 * `secondlayer bootstrap`, `verify`, and `repair` refuse a manifest they
 * cannot verify, so a self-hosted instance with no network path to the hosted
 * API still needs a key it can trust. Shipping it here means the trust root
 * travels with the CLI rather than with whichever host answers
 * `/public/streams/signing-key`.
 *
 * Tradeoff: rotating this key is a CLI release until a root-signed key
 * ceremony lands. Operators who want a different root pin one with
 * `ARCHIVE_SIGNING_PUBLIC_KEY` or `--public-key`, which win over this value.
 *
 * Value: `GET https://api.secondlayer.tools/public/streams/signing-key`,
 * key_id `fHQWzs9ML2WIYakf`, ed25519, fetched 2026-08-27.
 */
export const ARCHIVE_ROOT_PUBLIC_KEY_PEM: string = [
	"-----BEGIN PUBLIC KEY-----",
	"MCowBQYDK2VwAyEAq7wXm235JkFbElDmTVdNtmTKqRLx4PzjBgZhyREUFis=",
	"-----END PUBLIC KEY-----",
	"",
].join("\n");

export const ARCHIVE_ROOT_KEY_ID: string = "fHQWzs9ML2WIYakf";
