import type { Command } from "commander";

/**
 * Marks a local-dev command group as frozen: fully functional, but hidden from
 * top-level help (pair with `.command(name, { hidden: true })`) and prefixed
 * with a one-line stderr notice on every invocation, including `--help` on the
 * group or any of its subcommands.
 */
export function markFrozen(cmd: Command): Command {
	let warned = false;
	const warn = () => {
		if (warned) return;
		warned = true;
		process.stderr.write(
			`⚠ \`sl ${cmd.name()}\` is frozen — no further investment; it may be removed in a future major. The hosted dev loop (sl subgraphs create/deploy) is the supported path.\n`,
		);
	};
	cmd.hook("preAction", warn);
	// `--help` bypasses action hooks; "beforeAll" help text applies to the group
	// and all its subcommands, so use it as a side-effect warning channel.
	cmd.addHelpText("beforeAll", () => {
		warn();
		return "";
	});
	return cmd;
}
