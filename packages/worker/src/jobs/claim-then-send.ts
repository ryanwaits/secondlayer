import { getErrorMessage, logger } from "@secondlayer/shared";

/**
 * Send a once-per-crossing email without losing it or sending it twice.
 *
 * `claim` writes the debounce mark and reports whether this runner won it.
 * Only the winner sends. If the send fails the mark is handed back with
 * `release`, so the next tick retries instead of treating a lost email as
 * sent. Returns true when this call sent the email.
 */
export async function claimThenSend(opts: {
	claim: () => Promise<boolean>;
	send: () => Promise<void>;
	release: () => Promise<void>;
}): Promise<boolean> {
	if (!(await opts.claim())) return false;
	try {
		await opts.send();
		return true;
	} catch (err) {
		try {
			await opts.release();
		} catch (releaseErr) {
			logger.error("Alert mark not released after failed send", {
				error: getErrorMessage(releaseErr),
			});
		}
		throw err;
	}
}
