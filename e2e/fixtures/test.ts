import {
	expect,
	test as base,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import * as fs from "node:fs";
import { MEETINGS_STATE_FILE, type MeetingsState } from "../global-setup";
import { STUB_MEDIA_SCRIPT } from "./media";
import { loginViaApi } from "../helpers/auth";
import { createMeetingViaApi, type MeetingType } from "../helpers/meeting";

const isCI = !!process.env.CI;
const previewTimeout = isCI ? 30_000 : 20_000;
const meetingReadyTimeout = isCI ? 45_000 : 20_000;

function readMeetingsState(): MeetingsState {
	const raw = fs.readFileSync(MEETINGS_STATE_FILE, "utf-8");
	return JSON.parse(raw) as MeetingsState;
}

interface Participant {
	context: BrowserContext;
	page: Page;
	joinMeeting(meetingId: string): Promise<void>;
	joinAsGuest(meetingId: string, guestName: string): Promise<void>;
	joinAsHost(meetingId: string): Promise<void>;
	endCall(): Promise<void>;
}

interface TestFixtures {
	hostPage: Page;
	meetingId: string;
	restrictedMeetingId: string;
	createMeeting: (meetingType?: MeetingType) => Promise<string>;
	createMeetingViaUi: (meetingType?: MeetingType) => Promise<string>;
	createParticipant: () => Promise<Participant>;
}

async function prepareContext(context: BrowserContext): Promise<void> {
	await context.addInitScript({ content: STUB_MEDIA_SCRIPT });
	await context.grantPermissions(["camera", "microphone"]);
}

async function waitForMeetingReady(page: Page): Promise<void> {
	await page.getByTestId("meeting-layout").waitFor({
		state: "visible",
		timeout: meetingReadyTimeout,
	});
	await expect(page.getByTestId("meeting-toolbar")).toBeVisible();
	await expect(page.getByTestId("toolbar-end-call")).toBeVisible();
}

async function joinFromPreview(page: Page): Promise<void> {
	const preview = page.getByTestId("meeting-preview");
	const meetingLayout = page.getByTestId("meeting-layout");
	const joinForm = preview.locator("form");

	await Promise.race([
		preview.waitFor({ state: "visible", timeout: previewTimeout }),
		meetingLayout.waitFor({ state: "visible", timeout: previewTimeout }),
	]);

	if (
		!(await meetingLayout.isVisible().catch(() => false)) &&
		(await preview.isVisible().catch(() => false))
	) {
		try {
			await joinForm.evaluate((form) => {
				(form as HTMLFormElement).requestSubmit();
			});
		} catch (error) {
			if (!(await meetingLayout.isVisible().catch(() => false))) {
				await page
					.getByTestId("join-meeting-preview-button")
					.click({ timeout: previewTimeout });
			}
		}
	}

	await waitForMeetingReady(page);
}

async function createMeetingViaUi(
	page: Page,
	meetingType: MeetingType = "open",
): Promise<string> {
	await page.getByTestId("home-page").waitFor({ state: "visible", timeout: 20_000 });

	if (meetingType === "open") {
		await page.getByTestId("create-open-meeting-button").click();
	} else {
		await page.getByTestId("create-meeting-options").click();
		await page.getByRole("menuitem", { name: "Create a restricted meeting" }).click();
	}

	await page.waitForURL(/\/meet\/[a-z0-9-]+(?:\?created=true)?$/);

	const url = new URL(page.url());
	const match = url.pathname.match(/\/meet\/([a-z0-9-]+)$/);
	if (!match) {
		throw new Error(`Could not extract meeting id from URL: ${page.url()}`);
	}

	return match[1];
}

async function buildParticipant(browser: Browser): Promise<Participant> {
	const context = await browser.newContext();
	await prepareContext(context);
	const page = await context.newPage();

	return {
		context,
		page,
		async joinMeeting(meetingId: string) {
			await page.goto(`/meet/${meetingId}`);
		},
		async joinAsGuest(meetingId: string, guestName: string) {
			await page.goto(`/meet/${meetingId}`);
			await expect(page.getByTestId("meeting-preview")).toBeVisible({
				timeout: previewTimeout,
			});
			await page.getByPlaceholder("John Doe").fill(guestName);
			await joinFromPreview(page);
		},
		async joinAsHost(meetingId: string) {
			await loginViaApi(context.request);
			await page.goto("/meet/");
			await page.goto(`/meet/${meetingId}?created=true`);
			await joinFromPreview(page);
		},
		async endCall() {
			await page.getByTestId("toolbar-end-call").click();
			await page.waitForURL("**/meet/");
		},
	};
}

export const test = base.extend<TestFixtures>({
	hostPage: async ({ browser }, use) => {
		const context = await browser.newContext();
		await prepareContext(context);
		await loginViaApi(context.request);
		const page = await context.newPage();
		await page.goto("/meet/");
		await use(page);
		await context.close();
	},

	createMeeting: async ({ hostPage }, use) => {
		await use(async (meetingType = "open") => {
			return createMeetingViaApi(hostPage.request, meetingType);
		});
	},

	createMeetingViaUi: async ({ hostPage }, use) => {
		await use(async (meetingType = "open") => {
			return createMeetingViaUi(hostPage, meetingType);
		});
	},

	meetingId: async ({}, use) => {
		await use(readMeetingsState().openMeetingId);
	},

	restrictedMeetingId: async ({}, use) => {
		await use(readMeetingsState().restrictedMeetingId);
	},

	createParticipant: async ({ browser }, use) => {
		const participants: Participant[] = [];

		await use(async () => {
			const participant = await buildParticipant(browser);
			participants.push(participant);
			return participant;
		});

		await Promise.all(
			participants.map((participant) => participant.context.close()),
		);
	},
});

export { expect, joinFromPreview, waitForMeetingReady };
export type { Participant };
