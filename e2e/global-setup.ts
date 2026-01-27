import type { FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0].use?.baseURL || "http://localhost:8096";
	const sfuURL = process.env.SFU_URL || "http://localhost:3000";

	await waitForService(baseURL, "Frontend");
	await waitForService(sfuURL, "SFU Server");
}

async function waitForService(
	url: string,
	name: string,
	maxRetries = 30,
	retryDelay = 1000,
) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok || response.status < 500) {
				return;
			}
		} catch {}

		if (i < maxRetries - 1) {
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}

	throw new Error(`${name} at ${url} did not become ready in time`);
}

export default globalSetup;
