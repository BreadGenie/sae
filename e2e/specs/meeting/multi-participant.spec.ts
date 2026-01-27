import { test, expect } from "../../fixtures";

test.describe("Multi-Participant Meeting", () => {
	test("two participants can join the same meeting", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins the same meeting
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// Both should see controls
		await p1.toolbar.waitForToolbarReady();
		await p2.toolbar.waitForToolbarReady();

		// Wait for participants to see each other
		await p1.meeting.waitForRemoteParticipant();
		await p2.meeting.waitForRemoteParticipant();

		// Verify participant count
		const p1Count = await p1.meeting.getParticipantCount();
		const p2Count = await p2.meeting.getParticipantCount();
		expect(p1Count).toBe(2);
		expect(p2Count).toBe(2);
	});

	test("participants can see each other in people panel", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins the same meeting
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// Open people panel on p1 and verify p2 is listed
		await p1.toolbar.openPeople();
		await p1.people.waitForPanelOpen();
		await p1.people.waitForParticipant("Test User Two");
		const p1Count = await p1.people.getParticipantCount();
		expect(p1Count).toBe(2);

		// Open people panel on p2 and verify p1 is listed
		await p2.toolbar.openPeople();
		await p2.people.waitForPanelOpen();
		await p2.people.waitForParticipant("Test User One");
		const p2Count = await p2.people.getParticipantCount();
		expect(p2Count).toBe(2);
	});

	test("when a participant leaves, others are notified", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins the same meeting
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// Wait for p1 to see p2
		await p1.meeting.waitForRemoteParticipant();

		// p2 leaves
		await p2.leaveMeeting();

		// p1 should eventually see only 1 participant (themselves)
		await p1.meeting.waitForParticipantCount(1, 15000);
	});

	test("three participants can join the same meeting", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// User 3 joins
		const p3 = await createParticipant();
		await p3.loginAndJoinMeeting("user3", meetingId);

		// Wait for all to see each other (3 participants total)
		await p1.meeting.waitForParticipantCount(3, 30000);
		await p2.meeting.waitForParticipantCount(3, 30000);
		await p3.meeting.waitForParticipantCount(3, 30000);
	});
});
