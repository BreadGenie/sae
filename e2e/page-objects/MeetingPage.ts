import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class MeetingPage {
	readonly page: Page;
	readonly meetingContainer: Locator;
	readonly participantTiles: Locator;
	readonly screenShareLayout: Locator;
	readonly loadingSpinner: Locator;
	readonly errorMessage: Locator;

	constructor(page: Page) {
		this.page = page;
		this.meetingContainer = page.locator("[data-meeting-component]");
		// Participant tiles don't have a stable class; count video elements with participant-id
		this.participantTiles = page.locator(
			"[data-meeting-component] video[participant-id]",
		);
		this.screenShareLayout = page.locator('[class*="screen-share-video"]');
		this.loadingSpinner = page.locator("text=/joining|connecting/i");
		this.errorMessage = page.locator('[class*="error"], text=/error|failed/i');
	}

	async goto(meetingId: string) {
		await this.page.goto(`/meet/${meetingId}`);
	}

	async waitForMeetingReady() {
		// Wait for meeting UI to be visible (loading complete)
		await expect(this.loadingSpinner).not.toBeVisible({ timeout: 30000 });
		await expect(this.meetingContainer).toBeVisible({ timeout: 10000 });
	}

	async waitForConnected() {
<<<<<<< HEAD
		// move mouse to show toolbar
		const vp = this.page.viewportSize() || { width: 1280, height: 800 };
		await this.page.mouse.move(
			(vp.width || 1280) / 2,
			(vp.height || 800) * 0.85,
		);
		await this.page.mouse.move(
			(vp.width || 1280) / 2,
			(vp.height || 800) * 0.9,
		);

		const endCall = this.page
			.getByRole("button", { name: /End Call/i })
			.first();
		await endCall.waitFor({ state: "visible", timeout: 30000 });

		await this.page.waitForTimeout(250);
=======
		// Wait until we're in the actual meeting (not preview or loading)
		await this.page.waitForFunction(
			() => {
				// Find the meeting container and ensure the end call button is present
				const meeting = document.querySelector("[data-meeting-component]");
				if (!meeting) return false;
				const hasEndCall = !!meeting.querySelector(
					'button[title="End Call"], button[aria-label="End Call"]',
				);
				const notLoading = !document.body.innerText.includes("Joining meeting");
				return hasEndCall && notLoading;
			},
			{ timeout: 30000 },
		);
>>>>>>> 9694b54 (test: add e2e tests)
	}

	async isConnected(): Promise<boolean> {
		const meeting = this.page.locator("[data-meeting-component]").first();
		if (!meeting) return false;
		const hasEndCall = await meeting
			.getByRole("button", { name: /End Call/i })
			.count();
		const bodyText = await this.page.textContent("body");
		const notLoading = bodyText ? !bodyText.includes("Joining meeting") : true;
		return hasEndCall > 0 && notLoading;
	}

	async waitForScreenShareVisible(timeout = 10000) {
		await expect(this.screenShareLayout).toBeVisible({ timeout });
	}

	async getParticipantCount(): Promise<number> {
		return await this.participantTiles.count();
	}

	async waitForParticipantCount(count: number, timeout = 30000) {
		await expect(this.participantTiles).toHaveCount(count, { timeout });
	}

	async hasLocalVideo(): Promise<boolean> {
		const videos = await this.page.locator("video").all();
		for (const video of videos) {
			const srcObject = await video.evaluate((el: HTMLVideoElement) => {
				return el.srcObject !== null;
			});
			if (srcObject) return true;
		}
		return false;
	}

	async waitForRemoteParticipant(timeout = 30000) {
		// Wait for at least 2 participants (self + remote)
		await this.waitForParticipantCount(2, timeout);
	}

	async isParticipantVideoOn(participantId: string): Promise<boolean> {
		const videoElem = this.page.locator(
			`video[participant-id="${participantId}"]`,
		);
		// check if earlier sibling div
		const videoCover = this.page.locator(
			`video[participant-id="${participantId}"] ~ div[class*="absolute"][class*="inset-0"]
		`,
		);
		if ((await videoCover.count()) > 0) return false;
		const isVisible = await videoElem.isVisible();
		return isVisible;
	}

	async isParticipantAudioOn(participantId: string): Promise<boolean> {
		// check if muted mic icon is present in participant tile
		const mutedIcon = this.page.locator(
			`[participant-id="${participantId}"] ~ div[class*="top-2"] svg[class*="lucide-mic-off"]`,
		);
		return (await mutedIcon.count()) === 0;
	}
}
