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
	// Inject a small init script to stub media APIs when running in CI/local test environments
	// This prevents getUserMedia/getDisplayMedia failures when fake devices are unavailable
	await context.addInitScript({
		content: `(() => {
			try {
				if (!window.navigator.mediaDevices) {
					// @ts-ignore
					window.navigator.mediaDevices = {};
				}

				function createFakeStream() {
					try {
						const canvas = document.createElement('canvas');
						canvas.width = 640;
						canvas.height = 480;
						const ctx = canvas.getContext('2d');
						let t = 0;
						function draw() {
							if (!ctx) return;
							ctx.fillStyle = '#000';
							ctx.fillRect(0,0,640,480);
							ctx.fillStyle = '#fff';
							ctx.font = '16px sans-serif';
							ctx.fillText('fake-video ' + (++t), 10, 20);
							requestAnimationFrame(draw);
						}
						draw();

						const videoStream = canvas.captureStream(30);
						// try to create an audio track
						let audioTracks = [];
						try {
							const AudioCtx = window.AudioContext || window.webkitAudioContext;
							const ac = new AudioCtx();
							const dest = ac.createMediaStreamDestination();
							const o = ac.createOscillator();
							o.frequency.value = 440;
							o.connect(dest);
							o.start();
							audioTracks = dest.stream.getAudioTracks();
						} catch (e) {
							audioTracks = [];
						}

						const tracks = [...videoStream.getVideoTracks(), ...audioTracks];
						return new MediaStream(tracks);
					} catch (e) { return new MediaStream(); }
				}

				const shared = createFakeStream();
				// @ts-ignore
				window.navigator.mediaDevices.getUserMedia = (constraints) => Promise.resolve(shared);
				// @ts-ignore
				window.navigator.mediaDevices.getDisplayMedia = (constraints) => Promise.resolve(shared);
			} catch (e) { /* ignore */ }
		})();`,
	});

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
