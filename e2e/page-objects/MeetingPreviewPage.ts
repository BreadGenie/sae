import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class MeetingPreviewPage {
	readonly page: Page;
	readonly previewContainer: Locator;
	readonly videoPreview: Locator;
	readonly micToggle: Locator;
	readonly cameraToggle: Locator;
	readonly joinButton: Locator;
	readonly guestNameInput: Locator;
	readonly waitingMessage: Locator;

	constructor(page: Page) {
		this.page = page;
		this.previewContainer = page
			.locator('[data-preview-component], [class*="preview"]')
			.first();
		this.videoPreview = page.locator("video").first();
		this.micToggle = page.getByRole("button", { name: "Toggle Audio" }).first();
		this.cameraToggle = page
			.getByRole("button", { name: "Toggle Video" })
			.first();
		this.joinButton = page
			.getByRole("button", { name: "Join Meeting" })
			.first();
		this.guestNameInput = page.locator(
			'input[placeholder*="John Doe"], input[name="guestName"]',
		);
		this.waitingMessage = page.locator('text="Waiting to be admitted"');
	}

	async waitForPreviewReady() {
		await expect(this.joinButton).toBeVisible({ timeout: 15000 });
	}

	async toggleMicrophone() {
		await this.micToggle.click();
	}

	async toggleCamera() {
		await this.cameraToggle.click();
	}

	async joinMeeting() {
		await this.joinButton.click();
	}

	async enterGuestName(name: string) {
		await this.guestNameInput.fill(name);
	}

	async joinAsGuest(name: string) {
		await this.enterGuestName(name);
		await this.joinMeeting();
	}

	async waitForLobby() {
		await expect(this.waitingMessage).toBeVisible({ timeout: 10000 });
	}
}
