"use client";

import { type FormEvent, useState } from "react";

// Values match the API's CONTACT_VOLUMES.
const VOLUMES = [
	{ value: "lt10m", label: "under 10M" },
	{ value: "10m-100m", label: "10M–100M" },
	{ value: "100m-1b", label: "100M–1B" },
	{ value: "gt1b", label: "over 1B" },
	{ value: "unsure", label: "not sure" },
] as const;

type Status =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "error"; message: string }
	| { kind: "done"; name: string; email: string; reference: string };

type FieldErrors = Partial<Record<"name" | "email" | "message", string>>;

export function ContactForm({ from }: { from?: string }) {
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const [errors, setErrors] = useState<FieldErrors>({});

	async function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);
		const field = (name: string) => String(data.get(name) ?? "").trim();
		const name = field("name");
		const email = field("email");
		const message = field("message");

		const found: FieldErrors = {};
		if (!name) found.name = "Add your name so we know who to reply to.";
		if (!email) found.email = "Add your work email so we can reply.";
		if (message.length < 10) {
			found.message = "Tell us a little about what you're building.";
		}
		setErrors(found);
		const first = (["name", "email", "message"] as const).find((k) => found[k]);
		if (first) {
			(form.elements.namedItem(first) as HTMLElement | null)?.focus();
			return;
		}

		setStatus({ kind: "sending" });
		try {
			const res = await fetch("/api/public/contact", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name,
					email,
					company: field("company"),
					volume: field("volume"),
					message,
					website: field("website"),
					source_page: from,
				}),
			});
			const body = (await res.json().catch(() => null)) as {
				id?: string;
				error?: string;
			} | null;
			if (!res.ok || !body?.id) {
				setStatus({
					kind: "error",
					message:
						res.status === 429
							? "Too many messages from this network. Try again later."
							: (body?.error ?? "That didn't go through. Try again."),
				});
				return;
			}
			setStatus({
				kind: "done",
				name: name.split(/\s+/)[0],
				email,
				reference: `ctc_${body.id.replace(/-/g, "").slice(0, 6)}`,
			});
		} catch {
			setStatus({
				kind: "error",
				message: "Couldn't reach the server. Check your connection and retry.",
			});
		}
	}

	if (status.kind === "done") {
		return (
			<output className="contact-done">
				<span className="contact-seal">Received</span>
				<span className="contact-done-title">
					Thanks, {status.name}. We have your message.
				</span>
				<span className="contact-done-body">
					You'll hear back at {status.email}, usually within one business day.
				</span>
				<span className="cap">reference {status.reference}</span>
			</output>
		);
	}

	return (
		<form className="contact-form" onSubmit={onSubmit} noValidate>
			<div className="contact-two">
				<div className="contact-field">
					<label htmlFor="contact-name">Name</label>
					<input
						type="text"
						id="contact-name"
						name="name"
						maxLength={120}
						autoComplete="name"
						aria-invalid={errors.name ? true : undefined}
					/>
					{errors.name && <p className="contact-err">{errors.name}</p>}
				</div>
				<div className="contact-field">
					<label htmlFor="contact-email">Work email</label>
					<input
						type="email"
						id="contact-email"
						name="email"
						maxLength={254}
						autoComplete="email"
						placeholder="you@company.com"
						aria-invalid={errors.email ? true : undefined}
					/>
					{errors.email && <p className="contact-err">{errors.email}</p>}
				</div>
			</div>
			<div className="contact-field">
				<label htmlFor="contact-company">
					Company <span className="cap">optional</span>
				</label>
				<input
					type="text"
					id="contact-company"
					name="company"
					maxLength={160}
					autoComplete="organization"
				/>
			</div>
			<fieldset className="contact-field">
				<legend>Rows a month, roughly</legend>
				<div className="contact-pills">
					{VOLUMES.map((v) => (
						<label key={v.value}>
							<input type="radio" name="volume" value={v.value} />
							<span>{v.label}</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="contact-field">
				<label htmlFor="contact-message">What you're building</label>
				<textarea
					id="contact-message"
					name="message"
					maxLength={4000}
					rows={5}
					aria-invalid={errors.message ? true : undefined}
				/>
				{errors.message && <p className="contact-err">{errors.message}</p>}
			</div>
			{/* Honeypot: people never see or fill it; bots do. */}
			<div className="contact-trap" aria-hidden="true">
				<label htmlFor="contact-website">Website</label>
				<input
					type="text"
					id="contact-website"
					name="website"
					tabIndex={-1}
					autoComplete="off"
				/>
			</div>
			{status.kind === "error" && (
				<p className="contact-err" role="alert">
					{status.message}
				</p>
			)}
			<div className="contact-foot">
				<button
					className="btn btn-pri"
					type="submit"
					disabled={status.kind === "sending"}
				>
					{status.kind === "sending" ? "Sending…" : "Send message"}
				</button>
				<p className="cap">Replies come from a person, not a list.</p>
			</div>
		</form>
	);
}
