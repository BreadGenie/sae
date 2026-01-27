import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class ChatPanel {
	readonly page: Page;
	readonly panel: Locator;
	readonly messageInput: Locator;
	readonly sendButton: Locator;
	readonly messages: Locator;
	readonly closeButton: Locator;

	constructor(page: Page) {
		this.page = page;
		// Locate chat panel inside the meeting container by visible header text
		this.panel = page
			.locator('[data-meeting-component] div:has-text("Chat")')
			.first();
		this.messageInput = page.locator(
			'input[placeholder*="message"], textarea[placeholder*="message"]',
		);
		this.sendButton = page
			.locator('button:has(svg[class*="send"]), button[type="submit"]')
			.first();
		// Scope messages and close button under the panel locator to avoid global ambiguities
		this.messages = this.panel.locator(".text-sm");
		this.closeButton = this.panel.locator("svg.cursor-pointer").first();
	}

	async waitForPanelOpen() {
		await expect(this.panel).toBeVisible({ timeout: 5000 });
		await expect(this.messageInput).toBeVisible({ timeout: 5000 });
	}

	async sendMessage(text: string) {
		// Dismiss any blocking toasts/notifications that may overlap the input/send button
		await this.dismissBlockingToasts();
		await this.messageInput.fill(text);
		await this.sendButton.click();
		await expect(this.messageInput).toHaveValue("");
	}

	async dismissBlockingToasts() {
		try {
			// Target frappe-ui toast items and other common toast wrappers
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
				try {
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
				} catch {
					try {
						const handle = await toast.elementHandle();
						if (handle)
							await this.page
								.evaluate((el) => el.remove(), handle)
								.catch(() => {});
					} catch {}
				}
			}
		} catch {}
	}

	async getMessageCount(): Promise<number> {
		return await this.messages.count();
	}

	async waitForMessage(text: string, timeout = 10000) {
		await expect(this.panel.locator(`text="${text}"`)).toBeVisible({ timeout });
	}

	async close() {
		await this.closeButton.click();
		await expect(this.panel).not.toBeVisible({ timeout: 5000 });
	}
}
