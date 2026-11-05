import { describe, expect, test } from "bun:test";
import postgres from "postgres";
import { tlsOptions } from "./tls.ts";

const sslOf = (url: string) => postgres(url, tlsOptions(url)).options.ssl;

describe("tlsOptions", () => {
	test("local hosts and docker aliases connect without TLS", () => {
		for (const host of ["localhost", "127.0.0.1", "postgres"]) {
			expect(tlsOptions(`postgres://u:p@${host}:5432/db`)).toEqual({});
		}
	});

	test("remote hosts and IPs require TLS by default", () => {
		for (const host of ["db.example.com", "172.18.0.2"]) {
			expect(tlsOptions(`postgres://u:p@${host}:5432/db`).ssl).toBeDefined();
		}
	});

	test("sslmode=disable in the URL turns TLS off for an IP host", () => {
		expect(sslOf("postgres://u:p@172.18.0.2:5432/db?sslmode=disable")).toBe(
			false,
		);
	});

	test("sslmode=require in the URL reaches postgres.js for a local host", () => {
		expect(sslOf("postgres://u:p@localhost:5432/db?sslmode=require")).toBe(
			"require",
		);
	});
});
