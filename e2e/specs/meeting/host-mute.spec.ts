import { test, expect } from "../../fixtures";

test.describe("Host Mute Broadcast", () => {
	test("host can mute a participant and others see the change", async ({
		createParticipant,
	}) => {
		const host = await createParticipant();
		const meetingId = await host.loginAndCreateMeeting("user1");

		const normalParticipant = await createParticipant();
		await normalParticipant.loginAndJoinMeeting("user2", meetingId);

		// Open people panel and mute normalParticipant
		await host.toolbar.openPeople();
		await host.people.waitForPanelOpen();
		await host.people.muteParticipant("Test User Two");

		// normalParticipant should observe being muted
		expect(await normalParticipant.toolbar.isMicMuted()).toBe(true);
	});
});
