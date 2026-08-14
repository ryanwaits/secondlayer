/** Lightweight verification ticker so the one-box profile has a child. */
const timer = setInterval(() => {}, 30_000);
const stop = () => {
	clearInterval(timer);
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
