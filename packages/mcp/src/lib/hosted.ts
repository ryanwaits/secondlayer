export const HOSTED_ARCHIVE_HOST = "api.secondlayer.tools";

export function isHostedArchiveUrl(url: string): boolean {
	try {
		return new URL(url).hostname === HOSTED_ARCHIVE_HOST;
	} catch {
		return false;
	}
}
