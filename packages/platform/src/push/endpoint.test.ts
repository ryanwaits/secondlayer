import { describe, expect, test } from "bun:test";
import { isPushServiceEndpoint } from "./endpoint.ts";

describe("isPushServiceEndpoint", () => {
	test("accepts the browser push services", () => {
		for (const url of [
			"https://fcm.googleapis.com/fcm/send/abc",
			"https://web.push.apple.com/abc",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
			"https://db5p.notify.windows.com/?token=abc",
			"https://api.push.apple.com/3/device/abc",
			"https://FCM.googleapis.com:443/fcm/send/abc",
		]) {
			expect(isPushServiceEndpoint(url), url).toBe(true);
		}
	});

	test("rejects other hosts, look-alikes, credentials, ports and schemes", () => {
		for (const url of [
			"https://evil.example/x",
			"https://fcm.googleapis.com.evil.example/x",
			"https://evilfcm.googleapis.com/x",
			"https://evil.example/?u=https://fcm.googleapis.com/x",
			"https://user:pw@fcm.googleapis.com/x",
			"https://fcm.googleapis.com:8443/x",
			"http://fcm.googleapis.com/x",
			"https://169.254.169.254/latest/meta-data",
			"https://push.services.mozilla.com/x",
			"https://notify.windows.com/x",
			"not a url",
			"",
		]) {
			expect(isPushServiceEndpoint(url), url).toBe(false);
		}
	});
});
