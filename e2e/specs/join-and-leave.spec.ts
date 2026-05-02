import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Joining and leaving", () => {
	test("authenticated user can create or join a custom room using the home input", async ({
		hostPage,
	}) => {
		const roomName = `Team Sync ${test.info().parallelIndex}`;

		await hostPage.goto("/meet/");
		await hostPage.getByTestId("meeting-code-input").fill(roomName);
		await hostPage.getByTestId("join-meeting-button").click();

		await hostPage.waitForURL(/\/meet\/[a-z0-9-]+$/);
		const firstUrl = new URL(hostPage.url());
		const firstMeetingId = firstUrl.pathname.split("/").pop();
		expect(firstMeetingId).toBeTruthy();

		await hostPage.goto("/meet/");
		await hostPage.getByTestId("meeting-code-input").fill(roomName);
		await hostPage.getByTestId("join-meeting-button").click();
		await hostPage.waitForURL(new RegExp(`/meet/${firstMeetingId}$`));
	});

	test("host can join a new meeting and leave it", async ({ hostPage, createMeetingViaUi }) => {
		const meetingId = await createMeetingViaUi();

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);

		await hostPage.getByTestId("toolbar-end-call").click();

		await hostPage.waitForURL("**/meet/");
		await expect(hostPage.getByTestId("home-page")).toBeVisible();
	});

	test("guest can join an open meeting from the preview", async ({ createParticipant, meetingId }) => {
		const guest = await createParticipant();

		await guest.joinAsGuest(meetingId, `Guest ${test.info().parallelIndex}`);

		await expect(guest.page.getByTestId("meeting-layout")).toBeVisible();
		await expect(guest.page.getByTestId("toolbar-end-call")).toBeVisible();
	});
});
