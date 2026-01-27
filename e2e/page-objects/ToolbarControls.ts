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
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.micButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.micButton.waitFor({ state: "visible", timeout: 5000 });
		await this.micButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(250);
	}

	async toggleCamera() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.cameraButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.cameraButton.waitFor({ state: "visible", timeout: 5000 });
		await this.cameraButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(300);
	}

	async toggleScreenShare() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.screenShareButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.screenShareButton.waitFor({ state: "visible", timeout: 5000 });
		await this.screenShareButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(300);
	}

	async openChat() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.chatButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.chatButton.waitFor({ state: "visible", timeout: 5000 });
		await this.chatButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(150);
	}

	async openPeople() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.peopleButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.peopleButton.waitFor({ state: "visible", timeout: 5000 });
		await this.peopleButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(150);
	}

	async raiseHand() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.raiseHandButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.raiseHandButton.waitFor({ state: "visible", timeout: 5000 });
		await this.raiseHandButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await this.page.waitForTimeout(150);
	}

	async endCall() {
<<<<<<< HEAD
		await this.dismissBlockingToasts();
		await this.revealToolbar();
		await this.endCallButton.click({ force: true });
=======
		await this.waitForToolbarVisible();
		await this.dismissBlockingToasts();
		await this.endCallButton.click();
>>>>>>> 9694b54 (test: add e2e tests)
		await expect(this.page.locator("[data-meeting-component]")).not.toBeVisible(
			{ timeout: 10000 },
		);
	}

	async isMicMuted(): Promise<boolean> {
<<<<<<< HEAD
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
		await this.page.waitForTimeout(500);

		// Then wait for camera button to be visible (confirms all toolbar buttons are ready)
		await this.cameraButton.waitFor({ state: "visible", timeout: 5000 });

		// Hover directly over the toolbar to keep it visible (triggers onMouseEnter)
		const toolbarBox = await this.toolbar.boundingBox();
		if (toolbarBox) {
			await this.page.mouse.move(
				toolbarBox.x + toolbarBox.width / 2,
				toolbarBox.y + toolbarBox.height / 2,
			);
		}

		await this.page.waitForTimeout(200);
=======
		// Check if mic button has "off" indicator
		const micIcon = this.page.locator('button:has(svg[class*="mic-off"])');
		return (await micIcon.count()) > 0;
	}

	async isCameraMuted(): Promise<boolean> {
		// Check if camera button has "off" indicator
		const cameraIcon = this.page.locator('button:has(svg[class*="video-off"])');
		return (await cameraIcon.count()) > 0;
	}

	async waitForToolbarReady() {
		await this.dismissBlockingToasts();
		// Wait for at least one primary control (mic/camera/people/end-call) to be visible.
		// Wrap the wait so we can give better diagnostics if the page/context closes while waiting.
		try {
			await this.page.waitForFunction(
				() => {
					const sel =
						'[data-meeting-component] button:has(svg[class*="mic"]), [data-meeting-component] button:has(svg[class*="video"]), [data-meeting-component] button:has(svg[class*="users"]), [data-meeting-component] button:has(svg[class*="phone-off"]), [data-meeting-component] button[class*="red"]';
					const els = Array.from(
						document.querySelectorAll(sel),
					) as HTMLElement[];
					for (const el of els) {
						const r = el.getBoundingClientRect();
						if (r.width > 0 && r.height > 0) return true;
					}
					return false;
				},
				{ timeout: 10000 },
			);
		} catch {}
	}

	async waitForToolbarVisible() {
		// Move mouse to keep controls alive (prevent auto-hide)
		const viewport = this.page.viewportSize();
		if (viewport) {
			await this.page.mouse.move(viewport.width / 2, viewport.height * 0.8);
		}

		// Ensure toolbar and primary controls are visible
		await this.waitForToolbarReady();
		await expect(this.cameraButton).toBeVisible({ timeout: 5000 });
>>>>>>> 9694b54 (test: add e2e tests)
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
