import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class PeoplePanel {
	readonly page: Page;
	readonly panel: Locator;
	readonly participantItems: Locator;
	readonly closeButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.panel = page.locator(
			'[data-meeting-component] [class*="people-panel"]',
		);
		this.participantItems = this.panel.locator('[class*="participant-tile"]');
		this.closeButton = this.panel
			.locator('button:has(svg[class*="x"]), button[aria-label*="close"]')
			.first();
	}

	async waitForPanelOpen() {
		await expect(this.panel).toBeVisible({ timeout: 5000 });
		return;
	}

	async getParticipantCount(): Promise<number> {
		return await this.participantItems.count();
	}

	async waitForParticipant(name: string, timeout = 10000) {
		await expect(this.panel.locator(`text="${name}"`)).toBeVisible({
			timeout,
		});
		return;
	}

	async close() {
		await this.closeButton.click();
		await expect(this.panel).not.toBeVisible({ timeout: 5000 });
	}

	async approveWaitingUser(_name: string) {
		// Find the first visible button containing "Admit" text and click it
		// The button will be from the popup
		const admitButton = this.page
			.locator("button")
			.filter({ hasText: "Admit" })
			.first();
		await admitButton.click();
	}

	async rejectWaitingUser(name: string) {
		const initialInCapital = "TU"; // Initial text from avatar thingy
		const userRow = this.panel.getByText(`${initialInCapital}${name}`).first();
		const rejectButton = userRow.locator(
			'button:has-text("Reject"), button:has(svg[class*="x"])',
		);
		await rejectButton.click();
	}

	async muteParticipant(name: string) {
		const initialInCapital = "TU"; // Initial text from avatar thingy
		const userRow = this.panel.getByText(`${initialInCapital}${name}`).first();
		await userRow
			.locator("button:has(svg[class*='lucide-ellipsis-vertical'])")
			.click();

		// Click "Mute" from the dropdown menu
		// Mute isn't tethered to the row or panel
		await this.page.getByRole("menuitem", { name: "Mute" }).click();
	}

	async unmuteParticipant(name: string) {
		const initialInCapital = "TU"; // Initial text from avatar thingy
		const userRow = this.panel.getByText(`${initialInCapital}${name}`).first();
		await userRow
			.locator("button:has(svg[class*='lucide-ellipsis-vertical'])")
			.click();

		// Click "Unmute" from the dropdown menu
		// Unmute isn't tethered to the row or panel
		await this.page.getByRole("menuitem", { name: "Unmute" }).click();
	}
}
