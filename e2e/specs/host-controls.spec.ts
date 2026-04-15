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

	test("host can remove a guest participant", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const guestName = `Guest Remove ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, guestName);

		const guestTileOnHost = hostPage
			.locator("[data-testid^='participant-tile-']")
			.filter({ hasText: guestName })
			.first();

		await expect(guestTileOnHost).toBeVisible();
		await guestTileOnHost.hover();
		await guestTileOnHost
			.getByRole("button", { name: "Remove participant" })
			.click();

		await expect(hostPage.getByText("Remove Participant")).toBeVisible();
		await hostPage.getByRole("button", { name: "Remove", exact: true }).click();

		await expect(guestTileOnHost).toHaveCount(0);
		await expect(guest.page.getByTestId("meeting-layout")).toHaveCount(0);
		await expect
			.poll(async () => {
				const url = guest.page.url();
				if (url.includes("/login")) {
					return "login";
				}
				if (url.endsWith("/meet/")) {
					return "home";
				}
				return "other";
			})
			.toMatch(/login|home/);
	});
});