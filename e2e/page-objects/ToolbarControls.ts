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
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.micButton.click({ force: true });
		await this.page.waitForTimeout(250);
	}

	async toggleCamera() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.cameraButton.click({ force: true });
		await this.page.waitForTimeout(300);
	}

	async toggleScreenShare() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.screenShareButton.click({ force: true });
		await this.page.waitForTimeout(300);
	}

	async openChat() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.chatButton.click({ force: true });
		await this.page.waitForTimeout(150);
	}

	async openPeople() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.peopleButton.click({ force: true });
		await this.page.waitForTimeout(150);
	}

	async raiseHand() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.raiseHandButton.click({ force: true });
		await this.page.waitForTimeout(150);
	}

	async endCall() {
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.endCallButton.click({ force: true });
		await expect(this.page.locator("[data-meeting-component]")).not.toBeVisible(
			{ timeout: 10000 },
		);
	}

	async isMicMuted(): Promise<boolean> {
		await this.revealToolbar();
		// Check if mic button has "off" indicator
		const micBtn = this.toolbar
			.getByRole("button", { name: "Toggle Audio" })
			.first();
		const html = await micBtn.innerHTML();
		return html.includes("lucide-mic-off");
	}

	async isCameraMuted(): Promise<boolean> {
		await this.revealToolbar();
		// Check if camera button has "off" indicator
		const camBtn = this.toolbar
			.getByRole("button", { name: "Toggle Video" })
			.first();
		const html = await camBtn.innerHTML();
		return html.includes("lucide-video-off");
	}

	async revealToolbar() {
		const viewport = this.page.viewportSize();
		if (!viewport) return;

		// Move mouse to bottom center to trigger activity and reveal toolbar
		await this.page.mouse.move(viewport.width / 2, viewport.height - 50);

		// Wait for toolbar to appear
		await this.cameraButton.waitFor({ state: "attached", timeout: 5000 });

		// Hover directly over the toolbar to keep it visible (triggers onMouseEnter)
		const toolbarBox = await this.toolbar.boundingBox();
		if (toolbarBox) {
			await this.page.mouse.move(
				toolbarBox.x + toolbarBox.width / 2,
				toolbarBox.y + toolbarBox.height / 2,
			);
		}
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
