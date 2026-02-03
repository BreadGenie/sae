import { test, expect } from "../../fixtures";

test.describe("Guest Chat & Visibility", () => {
	test("guest can join an open meeting and send chat", async ({
		createParticipant,
	}) => {
		const host = await createParticipant();
		const meetingId = await host.loginAndCreateMeeting("user1");

		const guest = await createParticipant();
		await guest.joinMeeting(meetingId);

		// Workaround for socket.io closing issue
		await guest.page.waitForTimeout(1000);
		await guest.page.reload();
		await guest.page.waitForTimeout(2000);

		await guest.meetingPreview.joinAsGuest("Guest One");

		await host.meeting.waitForParticipantCount(2);

		// Guest sends a chat
		await guest.toolbar.openChat();
		await guest.chat.waitForPanelOpen();
		await guest.chat.sendMessage("Hello from guest");

		// Others should see the message
		await host.toolbar.openChat();
		await host.chat.waitForMessage("Hello from guest");
	});
});
