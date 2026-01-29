import { test, expect } from "../../fixtures";

test.describe("Video Toggle", () => {
	test("should be able to toggle camera off and on", async ({
		participant,
	}) => {
		await participant.loginAndCreateMeeting("user1");
		await participant.toolbar.dismissBlockingToasts();

		// Camera should start on (based on preview settings)
		const initiallyMuted = await participant.toolbar.isCameraMuted();

		// Toggle camera
		await participant.toolbar.toggleCamera();

		// State should change
		const afterToggle = await participant.toolbar.isCameraMuted();
		expect(afterToggle).not.toBe(initiallyMuted);

		// Toggle back
		await participant.toolbar.toggleCamera();

		// Should be back to initial state
		const afterSecondToggle = await participant.toolbar.isCameraMuted();
		expect(afterSecondToggle).toBe(initiallyMuted);
	});

	test("remote participant should see video state change", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins the same meeting
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// Wait for both to be in meeting
		await p1.meeting.waitForRemoteParticipant();
		await p2.meeting.waitForRemoteParticipant();

		// p1 toggles camera off
		await p1.toolbar.toggleCamera();

		// Give time for state to propagate
		await p1.page.waitForTimeout(1000);

		// p2 should see that p1's video is off
		const p1VideoStateOnP2 = await p2.meeting.isParticipantVideoOn(
			"test-user-1@example.com",
		);
		expect(p1VideoStateOnP2).toBe(false);

		// p1 toggles camera back on
		await p1.toolbar.toggleCamera();

		// Give time for state to propagate
		await p1.page.waitForTimeout(3000);

		// p2 should see that p1's video is on
		const p1VideoStateOnP2After = await p2.meeting.isParticipantVideoOn(
			"test-user-1@example.com",
		);
		expect(p1VideoStateOnP2After).toBe(true);
	});
});

test.describe("Audio Toggle", () => {
	test("should be able to toggle microphone off and on", async ({
		participant,
	}) => {
		await participant.loginAndCreateMeeting("user1");
		await participant.toolbar.dismissBlockingToasts();

		const initiallyMuted = await participant.toolbar.isMicMuted();

		// Toggle mic
		await participant.toolbar.toggleMicrophone();

		const afterToggle = await participant.toolbar.isMicMuted();
		expect(afterToggle).not.toBe(initiallyMuted);

		// Toggle back
		await participant.toolbar.toggleMicrophone();

		const afterSecondToggle = await participant.toolbar.isMicMuted();
		expect(afterSecondToggle).toBe(initiallyMuted);
	});

	test("remote participant should see audio state change", async ({
		createParticipant,
	}) => {
		// User 1 creates and joins meeting
		const p1 = await createParticipant();
		const meetingId = await p1.loginAndCreateMeeting("user1");

		// User 2 joins the same meeting
		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		// Wait for both to be in meeting
		await p1.meeting.waitForRemoteParticipant();
		await p2.meeting.waitForRemoteParticipant();

		// p1 mutes mic
		await p1.toolbar.toggleMicrophone();

		// Give time for state to propagate
		await p1.page.waitForTimeout(1000);

		// p2 should see that p1's mic is muted
		const p1AudioStateOnP2 = await p2.meeting.isParticipantAudioOn(
			"test-user-1@example.com",
		);
		expect(p1AudioStateOnP2).toBe(false);

		// p1 unmutes mic
		await p1.toolbar.toggleMicrophone();

		// Give time for state to propagate
		await p1.page.waitForTimeout(3000);

		// p2 should see that p1's mic is unmuted
		const p1AudioStateOnP2After = await p2.meeting.isParticipantAudioOn(
			"test-user-1@example.com",
		);
		expect(p1AudioStateOnP2After).toBe(true);
	});
});
