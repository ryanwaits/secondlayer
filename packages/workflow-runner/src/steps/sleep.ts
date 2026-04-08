/**
 * SleepInterrupt is a control-flow exception.
 * When thrown, the processor catches it and re-enqueues the workflow
 * with `scheduled_for` set to the resume time. The worker is freed
 * immediately — no slot is held during the sleep duration.
 *
 * On resume, the handler re-runs from the top. All steps before the
 * sleep return memoized output. The post-sleep steps execute normally.
 */
export class SleepInterrupt extends Error {
	readonly resumeAt: Date;

	constructor(resumeAt: Date) {
		super(`Sleep until ${resumeAt.toISOString()}`);
		this.name = "SleepInterrupt";
		this.resumeAt = resumeAt;
	}
}
