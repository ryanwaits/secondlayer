import type { Command } from "commander";
import {
	getAccountProfile,
	handleApiError,
	updateAccountProfile,
} from "../lib/api-client.ts";
import { dim, formatKeyValue, success } from "../lib/output.ts";

export function registerAccountCommand(program: Command): void {
	const account = program
		.command("account")
		.description("Manage your account profile");

	account
		.command("profile")
		.description("View or update your public profile")
		.option("--name <name>", "Set display name")
		.option("--bio <bio>", "Set bio")
		.option("--slug <slug>", "Set public URL slug")
		.option("--json", "Output as JSON")
		.action(
			async (options: {
				name?: string;
				bio?: string;
				slug?: string;
				json?: boolean;
			}) => {
				try {
					const hasUpdates = options.name || options.bio || options.slug;

					if (hasUpdates) {
						const data: {
							display_name?: string;
							bio?: string;
							slug?: string;
						} = {};
						if (options.name) data.display_name = options.name;
						if (options.bio) data.bio = options.bio;
						if (options.slug) data.slug = options.slug;

						const updated = await updateAccountProfile(data);

						if (options.json) {
							console.log(JSON.stringify(updated, null, 2));
							return;
						}

						success("Profile updated");
						console.log(
							formatKeyValue([
								["Display Name", updated.displayName ?? dim("—")],
								["Bio", updated.bio ?? dim("—")],
								["Slug", updated.slug ?? dim("—")],
							]),
						);
						return;
					}

					// Show current profile
					const profile = await getAccountProfile();

					if (options.json) {
						console.log(JSON.stringify(profile, null, 2));
						return;
					}

					console.log(
						formatKeyValue([
							["Email", profile.email],
							["Plan", profile.plan],
							["Display Name", profile.displayName ?? dim("—")],
							["Bio", profile.bio ?? dim("—")],
							["Slug", profile.slug ?? dim("—")],
						]),
					);
				} catch (err) {
					handleApiError(err, "manage profile");
				}
			},
		);
}
