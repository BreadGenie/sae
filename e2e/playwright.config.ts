import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./specs",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	maxFailures: process.env.CI ? 3 : 0,
	reporter: process.env.CI
		? [
				["github"],
				["html", { open: "never" }],
				["junit", { outputFile: "results.xml" }],
			]
		: [["html", { open: "on-failure" }]],
	timeout: process.env.CI ? 120000 : 60000,
	use: {
		baseURL: process.env.BASE_URL || "http://localhost:8096",
		actionTimeout: process.env.CI ? 15000 : 5000,
		trace: "retain-on-failure",
		video: "retain-on-failure",
		screenshot: "only-on-failure",
		viewport: { width: 1280, height: 720 },
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
						"--disable-background-timer-throttling",
						"--disable-renderer-backgrounding",
						"--disable-features=VizDisplayCompositor,TranslateUI",
						"--disable-ipc-flooding-protection",
						"--disable-rtc-smoothness-algorithm",
						"--enable-webrtc-srtp-aes-gcm",
						"--force-webrtc-ip-handling-policy=default_public_interface_only",
						...(process.env.CI
							? [
									"--disable-backgrounding-occluded-windows",
									"--disable-background-media-suspend",
									"--disable-extensions",
									"--disable-component-extensions-with-background-pages",
								]
							: []),
					],
				},
				permissions: ["camera", "microphone"],
			},
		},
	],
	globalSetup: require.resolve("./global-setup"),
});
