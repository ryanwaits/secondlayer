export interface SlackMessage {
	text: string;
	blocks?: Array<Record<string, unknown>>;
}
