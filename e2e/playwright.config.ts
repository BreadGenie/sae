import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./specs",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	maxFailures: process.env.CI ? 5 : 0,
	reporter: process.env.CI
		? [
				["github"],
				["html", { open: "never" }],
				["junit", { outputFile: "results.xml" }],
			]
		: [["html", { open: "on-failure" }]],
	timeout: 60000,
	use: {
		baseURL: process.env.BASE_URL || "http://localhost:8096",
		trace: "retain-on-failure",
		video: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: {
					args: [
						// Auto-grant media permissions (no permission dialogs)
						"--use-fake-ui-for-media-stream",
						// Use fake camera/microphone devices
						"--use-fake-device-for-media-stream",
						"--allow-insecure-localhost",
						"--disable-web-security",
						"--autoplay-policy=no-user-gesture-required",
						"--no-sandbox",
						"--disable-setuid-sandbox",
						"--disable-dev-shm-usage",
						"--disable-gpu",
						// Mute audio output
						"--mute-audio",
						// Treat the base URL as a secure origin to allow getUserMedia in CI
						`--unsafely-treat-insecure-origin-as-secure=${process.env.BASE_URL || "http://localhost:8096"}`,
					],
				},
				permissions: ["camera", "microphone"],
			},
		},
	],
	globalSetup: require.resolve("./global-setup"),
});
