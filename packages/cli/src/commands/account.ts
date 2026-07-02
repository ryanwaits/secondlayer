import type { Command } from "commander";
import {
	getAccountProfile,
	updateAccountProfile,
	withErrorHandling,
} from "../lib/api-client.ts";
import { dim, formatKeyValue, output, success } from "../lib/output.ts";
import { addBillingCommand } from "./billing.ts";

interface ProfileOptions {
	name?: string;
	bio?: string;
	slug?: string;
	notifyReindexComplete?: boolean;
	json?: boolean;
}

async function showProfile(json?: boolean): Promise<void> {
	const profile = await getAccountProfile();
	output({
		json,
		data: profile,
		human: () =>
			console.log(
				formatKeyValue([
					["Email", profile.email],
					["Plan", profile.plan],
					["Display Name", profile.displayName ?? dim("—")],
					["Bio", profile.bio ?? dim("—")],
					["Slug", profile.slug ?? dim("—")],
					[
						"Notify on reindex complete",
						profile.notifyReindexComplete ? "on" : "off",
					],
				]),
			),
	});
}

async function applyProfileUpdate(
	options: ProfileOptions,
	getOptionValueSource: (key: string) => string | undefined,
): Promise<void> {
	const data: {
		display_name?: string;
		bio?: string;
		slug?: string;
		notify_reindex_complete?: boolean;
	} = {};
	if (options.name) data.display_name = options.name;
	if (options.bio) data.bio = options.bio;
	if (options.slug) data.slug = options.slug;
	// --notify-reindex-complete/--no-notify-reindex-complete share one
	// negatable option; only touch the setting when the user actually passed
	// one of them — otherwise every unrelated `account update` (e.g. --bio)
	// would silently reset it back to commander's default (true).
	if (getOptionValueSource("notifyReindexComplete") === "cli") {
		data.notify_reindex_complete = options.notifyReindexComplete;
	}

	const updated = await updateAccountProfile(data);
	output({
		json: options.json,
		data: updated,
		human: () => {
			success("Profile updated");
			console.log(
				formatKeyValue([
					["Display Name", updated.displayName ?? dim("—")],
					["Bio", updated.bio ?? dim("—")],
					["Slug", updated.slug ?? dim("—")],
					[
						"Notify on reindex complete",
						updated.notifyReindexComplete ? "on" : "off",
					],
				]),
			);
		},
	});
}

export function registerAccountCommand(program: Command): void {
	const account = program
		.command("account")
		.description("Manage your account profile");

	addBillingCommand(account);

	account
		.command("get")
		.description("Show your account profile")
		.option("--json", "Output as JSON")
		.action(
			withErrorHandling(
				async (options: { json?: boolean }) => showProfile(options.json),
				{ action: "show profile" },
			),
		);

	account
		.command("update")
		.description("Update your public profile")
		.option("--name <name>", "Set display name")
		.option("--bio <bio>", "Set bio")
		.option("--slug <slug>", "Set public URL slug")
		.option(
			"--notify-reindex-complete",
			"Email me when a subgraph reindex finishes",
		)
		.option(
			"--no-notify-reindex-complete",
			"Don't email me when a subgraph reindex finishes",
		)
		.option("--json", "Output as JSON")
		.action(
			withErrorHandling(
				async (options: ProfileOptions, command: Command) =>
					applyProfileUpdate(options, (key) =>
						command.getOptionValueSource(key),
					),
				{
					action: "update profile",
				},
			),
		);
}
