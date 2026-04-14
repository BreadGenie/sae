import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Chat", () => {
	test("messages are delivered between host and guest", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const message = `hello-${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, `Guest Chat ${test.info().parallelIndex}`);

		await hostPage.getByTestId("toolbar-chat").click();
		await hostPage.getByPlaceholder("Type a message").fill(message);
		await hostPage.getByTestId("chat-send").click();

		await guest.page.getByTestId("toolbar-chat").click();
		await expect(guest.page.getByTestId("chat-messages")).toContainText(message);
	});
});
