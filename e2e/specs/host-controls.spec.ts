import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Host controls", () => {
	test("host can mute a guest participant", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const guestName = `Guest Mute ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, guestName);

		const guestTileOnHost = hostPage
			.locator("[data-testid^='participant-tile-']")
			.filter({ hasText: guestName })
			.first();

		await expect(guestTileOnHost).toBeVisible();
		await guestTileOnHost.hover();
		await guestTileOnHost.getByRole("button", { name: "Mute participant" }).click();

		await expect(guestTileOnHost).toHaveAttribute("data-audio-enabled", "false");
		await expect(
			guest.page.locator("[data-testid^='participant-tile-guest_'][data-audio-enabled='false']"),
		).toHaveCount(1);
	});
});