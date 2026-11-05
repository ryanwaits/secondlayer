export type {
	EmailCta,
	EmailStatus,
	EmailTone,
	FactRow,
	RenderedEmail,
	RenderEmailInput,
} from "./render.ts";
export { renderEmail } from "./render.ts";
export type { SendEmailInput, SendEmailResult } from "./send.ts";
export { sendEmail } from "./send.ts";
export {
	UPDATES_API_URL,
	UPDATES_FROM,
	UPDATES_SITE_URL,
	confirmEmail,
	unsubscribeFor,
} from "./updates.ts";
