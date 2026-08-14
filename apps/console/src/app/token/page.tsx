import { redirect } from "next/navigation";
import { unlock } from "./unlock";

/**
 * Token gate. One field, no account: paste the instance token from
 * `secondlayer init` (`.env.local`, `INSTANCE_TOKEN`). A correct token sets
 * the `sl_console` cookie and returns to the requested screen.
 */
export default async function TokenPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string; error?: string }>;
}) {
	const params = await searchParams;
	if (!process.env.CONSOLE_TOKEN && !process.env.INSTANCE_TOKEN) {
		redirect("/");
	}
	return (
		<main className="token-gate">
			<form action={unlock}>
				<h1>Instance token</h1>
				<p>
					This console is reachable beyond loopback, so it takes the same token
					as the API — <code>INSTANCE_TOKEN</code> from{" "}
					<code>secondlayer init</code>.
				</p>
				{params.error ? (
					<p className="token-error">
						That token didn&apos;t match. Try again.
					</p>
				) : null}
				<input
					type="password"
					name="token"
					placeholder="sl_…"
					autoComplete="off"
					required
				/>
				<input type="hidden" name="next" value={params.next ?? "/"} />
				<button type="submit">Open console</button>
			</form>
		</main>
	);
}
