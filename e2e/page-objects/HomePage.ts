import type { Page, Locator } from "@playwright/test";

export class HomePage {
	readonly page: Page;
	readonly meetingCodeInput: Locator;
	readonly joinButton: Locator;
	readonly startMeetingButton: Locator;
	readonly createRestrictedDropdown: Locator;

	constructor(page: Page) {
		this.page = page;
		this.meetingCodeInput = page.getByRole("textbox", { name: "Meeting Code" });
		this.joinButton = page.getByRole("button", { name: "Join" });
		this.startMeetingButton = page.getByRole("button", {
			name: "Start new meeting",
		});
		this.createRestrictedDropdown = page.locator(
			'button:has(svg[class*="chevron"])',
		);
	}

	async goto() {
		await this.page.goto("/meet/");
	}

	async createMeeting(type: "open" | "restricted" = "open"): Promise<string> {
		if (type === "restricted") {
			await this.createRestrictedDropdown.click();
			await this.page
				.getByRole("menuitem", { name: "Create a restricted meeting" })
				.click();
		} else {
			await this.startMeetingButton.click();
		}

		await this.page.waitForURL(/\/meet\/[a-z]{4}-[a-z]{4}-[a-z]{4}/, {
			timeout: 15000,
		});

		const url = this.page.url();
		const match = url.match(/\/meet\/([a-z]{4}-[a-z]{4}-[a-z]{4})/);
		if (!match) {
			throw new Error(`Could not extract meeting ID from URL: ${url}`);
		}

		return match[1];
	}

	async joinMeeting(meetingCode: string) {
		await this.meetingCodeInput.fill(meetingCode);
		await this.joinButton.click();
		await this.page.waitForURL(`/meet/${meetingCode}`, { timeout: 10000 });
	}
}
