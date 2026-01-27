import {
	test as base,
	type Page,
	type BrowserContext,
	type Browser,
} from "@playwright/test";
import {
	LoginPage,
	HomePage,
	MeetingPage,
	MeetingPreviewPage,
	ToolbarControls,
	ChatPanel,
	PeoplePanel,
} from "../page-objects";
import { TEST_USERS, type TestUserKey } from "./test-users";

export class Participant {
	readonly context: BrowserContext;
	readonly page: Page;
	readonly login: LoginPage;
	readonly home: HomePage;
	readonly meetingPreview: MeetingPreviewPage;
	readonly meeting: MeetingPage;
	readonly toolbar: ToolbarControls;
	readonly chat: ChatPanel;
	readonly people: PeoplePanel;

	private _isLoggedIn = false;
	private _currentMeetingId: string | null = null;

	constructor(context: BrowserContext, page: Page) {
		this.context = context;
		this.page = page;
		this.login = new LoginPage(page);
		this.home = new HomePage(page);
		this.meetingPreview = new MeetingPreviewPage(page);
		this.meeting = new MeetingPage(page);
		this.toolbar = new ToolbarControls(page);
		this.chat = new ChatPanel(page);
		this.people = new PeoplePanel(page);
	}

	async loginAs(userKey: TestUserKey) {
		const user = TEST_USERS[userKey];
		await this.login.goto();
		await this.login.loginAndWait(user.email, user.password);
		this._isLoggedIn = true;
	}

	async createMeeting(type: "open" | "restricted" = "open"): Promise<string> {
		await this.home.goto();
		const meetingId = await this.home.createMeeting(type);
		this._currentMeetingId = meetingId;
		return meetingId;
	}

	async joinMeeting(meetingId: string) {
		await this.meeting.goto(meetingId);
		this._currentMeetingId = meetingId;
	}

	async joinFromPreview() {
		await this.meetingPreview.waitForPreviewReady();
		await this.meetingPreview.joinMeeting();
		await this.meeting.waitForConnected();
	}

	// Flow: login, create meeting, join from preview
	async loginAndCreateMeeting(
		userKey: TestUserKey,
		type: "open" | "restricted" = "open",
	): Promise<string> {
		await this.loginAs(userKey);
		const meetingId = await this.createMeeting(type);
		await this.joinFromPreview();
		return meetingId;
	}

	// Flow: login, navigate to meeting, join from preview
	async loginAndJoinMeeting(userKey: TestUserKey, meetingId: string) {
		await this.loginAs(userKey);
		await this.joinMeeting(meetingId);
		await this.joinFromPreview();
	}

	async leaveMeeting() {
		await this.toolbar.endCall();
		this._currentMeetingId = null;
	}

	async toBeInMeeting(meetingId: string): Promise<boolean> {
		const url = this.page.url();

		const isInMeeting = url.includes(`/meet/${meetingId}`);
		const isMeetingConnected = await this.meeting.isConnected();

		return isInMeeting && isMeetingConnected;
	}

	get isLoggedIn(): boolean {
		return this._isLoggedIn;
	}

	get currentMeetingId(): string | null {
		return this._currentMeetingId;
	}
}

async function createParticipant(browser: Browser): Promise<Participant> {
	const context = await browser.newContext();
	const page = await context.newPage();
	return new Participant(context, page);
}

interface ParticipantFixtures {
	participant: Participant;
	createParticipant: () => Promise<Participant>;
}

export const test = base.extend<ParticipantFixtures>({
	participant: async ({ browser }, use) => {
		const participant = await createParticipant(browser);
		await use(participant);
		await participant.context.close();
	},

	createParticipant: async ({ browser }, use) => {
		const participants: Participant[] = [];

		const factory = async () => {
			const p = await createParticipant(browser);
			participants.push(p);
			return p;
		};

		await use(factory);

		for (const p of participants) {
			await p.context.close();
		}
	},
});

export { expect } from "@playwright/test";
