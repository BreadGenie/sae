import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class ToolbarControls {
	readonly page: Page;
	readonly toolbar: Locator;
	readonly micButton: Locator;
	readonly cameraButton: Locator;
	readonly screenShareButton: Locator;
	readonly chatButton: Locator;
	readonly peopleButton: Locator;
	readonly raiseHandButton: Locator;
	readonly endCallButton: Locator;

	constructor(page: Page) {
		this.page = page;
		// Locate toolbar by finding the meeting container's block that contains the End Call button
		this.toolbar = page
			.locator('[data-meeting-component] div:has(button[title="End Call"])')
			.first();

		// Use lucide icon names for button identification
		this.micButton = page.getByRole("button", { name: "Toggle Audio" }).first();
		this.cameraButton = page
			.getByRole("button", { name: "Toggle Video" })
			.first();
		this.screenShareButton = page
			.locator('button:has(svg[class*="lucide-monitor"])')
			.first();
		this.chatButton = page.getByRole("button", { name: "Show Chat" }).first();
		this.peopleButton = page
			.getByRole("button", { name: "Show Participants" })
			.first();
		this.raiseHandButton = page
			.getByRole("button", { name: "Raise Hand" })
			.first();
		this.endCallButton = page.getByRole("button", { name: "End Call" }).first();
	}

	async toggleMicrophone() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.micButton.waitFor({ state: "visible", timeout: 5000 });
		await this.micButton.click();
		await this.page.waitForTimeout(250);
	}

	async toggleCamera() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.cameraButton.waitFor({ state: "visible", timeout: 5000 });
		await this.cameraButton.click();
		await this.page.waitForTimeout(300);
	}

	async toggleScreenShare() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.screenShareButton.waitFor({ state: "visible", timeout: 5000 });
		await this.screenShareButton.click();
		await this.page.waitForTimeout(300);
	}

	async openChat() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.chatButton.waitFor({ state: "visible", timeout: 5000 });
		await this.chatButton.click();
		await this.page.waitForTimeout(150);
	}

	async openPeople() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.peopleButton.waitFor({ state: "visible", timeout: 5000 });
		await this.peopleButton.click();
		await this.page.waitForTimeout(150);
	}

	async raiseHand() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.raiseHandButton.waitFor({ state: "visible", timeout: 5000 });
		await this.raiseHandButton.click();
		await this.page.waitForTimeout(150);
	}

	async endCall() {
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.endCallButton.click();
		await expect(this.page.locator("[data-meeting-component]")).not.toBeVisible(
			{ timeout: 10000 },
		);
	}

	async isMicMuted(): Promise<boolean> {
		// Check if mic button has "off" indicator
		const micBtn = this.toolbar
			.getByRole("button", { name: "Toggle Audio" })
			.first();
		const html = await micBtn.innerHTML();
		return html.includes("lucide-mic-off");
	}

	async isCameraMuted(): Promise<boolean> {
		// Check if camera button has "off" indicator
		const camBtn = this.toolbar
			.getByRole("button", { name: "Toggle Video" })
			.first();
		const html = await camBtn.innerHTML();
		return html.includes("lucide-video-off");
	}

	async waitForToolbarVisible() {
		// Move mouse to keep controls alive (prevent auto-hide)
		const viewport = this.page.viewportSize();
		if (viewport) {
			await this.page.mouse.move(viewport.width / 2, viewport.height * 0.8);
		}

		// Ensure toolbar and primary controls are visible
		await this.dismissBlockingToasts();
		await expect(this.cameraButton).toBeVisible({ timeout: 5000 });
	}

	async dismissBlockingToasts() {
		try {
			const toasts = this.page.locator(
				'.toast-root-animatable[data-state="open"], .toast, .frappe-toast',
			);
			const count = await toasts.count();
			for (let i = 0; i < count; i++) {
				const toast = toasts.nth(i);
				if (!(await toast.isVisible())) continue;
				const closeBtn = toast.locator(
					'button, [role="button"], .ToastClose, .toast-close, svg.cursor-pointer',
				);
				if ((await closeBtn.count()) > 0) {
					await closeBtn
						.first()
						.click({ force: true })
						.catch(() => {});
					await this.page.waitForTimeout(150);
				} else {
					const handle = await toast.elementHandle();
					if (handle)
						await this.page
							.evaluate((el) => el.remove(), handle)
							.catch(() => {});
				}
			}
		} catch {}
	}
}
