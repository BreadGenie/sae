import { test } from "../../fixtures";

test.describe("Screen Share", () => {
	test("presenter shares screen and remotes see it", async ({
		createParticipant,
	}) => {
		const presenter = await createParticipant();
		const meetingId = await presenter.loginAndCreateMeeting("user1");

		const p2 = await createParticipant();
		await p2.loginAndJoinMeeting("user2", meetingId);

		const p3 = await createParticipant();
		await p3.loginAndJoinMeeting("user3", meetingId);

		// Presenter starts screen share
		await presenter.toolbar.toggleScreenShare();

		// Remote participants should see screen share layout
		await p2.meeting.waitForScreenShareVisible();
		await p3.meeting.waitForScreenShareVisible();
	});
});
