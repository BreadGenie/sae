import { test, expect } from "../../fixtures";

test.describe("Meeting Creation", () => {
	test("should create an open meeting and navigate to it", async ({
		participant,
	}) => {
		await participant.loginAs("user1");
		await participant.home.goto();

		const meetingId = await participant.home.createMeeting("open");

		expect(meetingId).toMatch(/^[a-z]{4}-[a-z]{4}-[a-z]{4}$/);
		expect(participant.page.url()).toContain(`/meet/${meetingId}`);
	});

	test("should create a restricted meeting", async ({ participant }) => {
		await participant.loginAs("user1");
		await participant.home.goto();

		const meetingId = await participant.home.createMeeting("restricted");

		expect(meetingId).toMatch(/^[a-z]{4}-[a-z]{4}-[a-z]{4}$/);
	});
});
