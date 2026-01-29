import { test, expect } from "../../fixtures";

test.describe("Join Meeting", () => {
	test("should join meeting from preview screen", async ({ participant }) => {
		const meetingId = await participant.loginAndCreateMeeting("user1");
		await participant.toolbar.dismissBlockingToasts();
		const isInMeeting = await participant.toBeInMeeting(meetingId);
		expect(isInMeeting).toBe(true);
	});

	test("should show meeting controls after joining", async ({
		participant,
	}) => {
		await participant.loginAndCreateMeeting("user1");

		await expect(participant.toolbar.micButton).toBeVisible();
		await expect(participant.toolbar.cameraButton).toBeVisible();
		await expect(participant.toolbar.endCallButton).toBeVisible();
	});

	test("should be able to join meeting via meeting code on home page", async ({
		participant,
		createParticipant,
	}) => {
		// User 1 creates a meeting
		const p1 = participant;
		await p1.loginAs("user1");
		const meetingId = await p1.createMeeting("open");
		await p1.joinFromPreview();

		// User 2 joins via meeting code
		const p2 = await createParticipant();
		await p2.loginAs("user2");
		await p2.home.goto();
		await p2.home.joinMeeting(meetingId);
		await p2.joinFromPreview();

		// Verify both users are in the meeting by checking
		// the tiles for both participants
		expect(await p1.meeting.getParticipantCount()).toBe(2);
		expect(await p2.meeting.getParticipantCount()).toBe(2);
	});

	test("should leave meeting when clicking end call", async ({
		participant,
	}) => {
		await participant.loginAndCreateMeeting("user1");
		await participant.toolbar.dismissBlockingToasts();

		await participant.leaveMeeting();

		await participant.page.waitForURL(
			(url) => !url.pathname.match(/\/meet\/[a-z]{4}-[a-z]{4}-[a-z]{4}/),
		);
	});
});
