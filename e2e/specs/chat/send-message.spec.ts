import { test } from "../../fixtures";

test.describe("Chat", () => {
	test.skip("chat messages should be visible to other participants", async ({
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

		// p1 sends a message
		await p1.toolbar.openChat();
		await p1.chat.waitForPanelOpen();
		await p1.chat.sendMessage("Hello from User 1!");
		await p1.chat.sendMessage("Bye from User 1!");

		// p2 opens chat and should see the message
		await p2.toolbar.openChat();
		await p2.chat.waitForPanelOpen();
		await p2.chat.waitForMessage("Hello from User 1!");
		await p2.chat.waitForMessage("Bye from User 1!");
	});
});
