import {
	expect,
	test as base,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page,
} from "@playwright/test";
import { STUB_MEDIA_SCRIPT } from "./media";

const HOST_EMAIL = process.env.E2E_HOST_EMAIL ?? "Administrator";
const HOST_PASSWORD = process.env.E2E_HOST_PASSWORD ?? "admin";

type MeetingType = "open" | "restricted";

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
	createMeeting: (meetingType?: MeetingType) => Promise<string>;
	createParticipant: () => Promise<Participant>;
}

async function loginViaApi(request: APIRequestContext): Promise<void> {
	const response = await request.post("/api/method/login", {
		form: {
			usr: HOST_EMAIL,
			pwd: HOST_PASSWORD,
		},
	});

	if (!response.ok()) {
		throw new Error(`Host login failed with status ${response.status()}`);
	}
}

async function createMeetingViaApi(
	request: APIRequestContext,
	meetingType: MeetingType = "open",
): Promise<string> {
	const response = await request.post("/api/method/meet.api.meeting.create", {
		form: {
			meeting_type: meetingType,
		},
	});

	if (!response.ok()) {
		throw new Error(`Meeting creation failed with status ${response.status()}`);
	}

	const payload = (await response.json()) as { message?: string };
	if (!payload.message) {
		throw new Error("Meeting creation returned no meeting id");
	}

	return payload.message;
}

async function prepareContext(context: BrowserContext): Promise<void> {
	await context.addInitScript({ content: STUB_MEDIA_SCRIPT });
	await context.grantPermissions(["camera", "microphone"]);
}

async function waitForMeetingReady(page: Page): Promise<void> {
	await page.getByTestId("meeting-layout").waitFor({
		state: "visible",
		timeout: 20_000,
	});
	await expect(page.getByTestId("meeting-toolbar")).toBeVisible();
	await expect(page.getByTestId("toolbar-end-call")).toBeVisible();
}

async function joinFromPreview(page: Page): Promise<void> {
	const preview = page.getByTestId("meeting-preview");
	const meetingLayout = page.getByTestId("meeting-layout");

	await Promise.race([
		preview.waitFor({ state: "visible", timeout: 20_000 }),
		meetingLayout.waitFor({ state: "visible", timeout: 20_000 }),
	]);

	if (
		!(await meetingLayout.isVisible().catch(() => false)) &&
		(await preview.isVisible().catch(() => false))
	) {
		try {
			await page
				.getByTestId("join-meeting-preview-button")
				.click({ force: true, timeout: 5_000 });
		} catch (error) {
			if (!(await meetingLayout.isVisible().catch(() => false))) {
				throw error;
			}
		}
	}

	await waitForMeetingReady(page);
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
			await expect(page.getByTestId("meeting-preview")).toBeVisible();
			await page.getByPlaceholder("John Doe").fill(guestName);
			await page.getByTestId("join-meeting-preview-button").click();
			await waitForMeetingReady(page);
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
			return createMeetingViaApi(hostPage.context().request, meetingType);
		});
	},

	meetingId: async ({ createMeeting }, use) => {
		await use(await createMeeting());
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
