export function LoadFailed({
	what,
	onRetry,
}: {
	what: string;
	onRetry: () => void;
}) {
	return (
		<p className="acct-muted">
			Couldn't load {what}.{" "}
			<button type="button" className="ky-link" onClick={onRetry}>
				Retry
			</button>
		</p>
	);
}
