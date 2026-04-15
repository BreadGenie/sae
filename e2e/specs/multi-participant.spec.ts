import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Multi participant", () => {
	test("host and two guests see the same meeting", async ({ hostPage, meetingId, createParticipant }) => {
		const guestOne = await createParticipant();
		const guestTwo = await createParticipant();

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);
		await guestOne.joinAsGuest(meetingId, `Guest One ${test.info().parallelIndex}`);
		await guestTwo.joinAsGuest(meetingId, `Guest Two ${test.info().parallelIndex}`);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(3);
		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toContainText("People (3)");
	});
});
