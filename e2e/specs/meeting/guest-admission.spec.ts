import { test } from "../../fixtures";

test.describe("Guest Admission (restricted)", () => {
	test("guest lands in lobby and host can admit", async ({
		createParticipant,
	}) => {
		const host = await createParticipant();
		const meetingId = await host.loginAndCreateMeeting("user1", "restricted");

		const guest = await createParticipant();
		await guest.joinMeeting(meetingId);

		// Workaround: Reload to ensure guest session cookies are properly set for Socket.IO
		await guest.page.waitForTimeout(1000);
		await guest.page.reload();
		await guest.page.waitForTimeout(2000);

		await guest.meetingPreview.joinAsGuest("Lobby Guest");
		await guest.meetingPreview.waitForLobby();
		// Wait for socket subscription to propagate to server
		await guest.page.waitForTimeout(2000);

		// Host should see popup notification and can admit the guest
		await host.people.approveWaitingUser("Lobby Guest");

		// Guest should join the meeting after admit
		await host.meeting.waitForParticipantCount(2);
	});
});
