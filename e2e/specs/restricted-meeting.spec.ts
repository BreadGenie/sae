import { test, expect, joinFromPreview } from "../fixtures/test";

const lobbyTransitionTimeout = process.env.CI ? 60_000 : 30_000;

test.describe("Restricted meeting", () => {
	test("guest waits for approval and host can admit from people panel", async ({
		hostPage,
		restrictedMeetingId,
		createParticipant,
	}) => {
		const meetingId = restrictedMeetingId;
		const guest = await createParticipant();
		const guestName = `Guest Restricted ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toBeVisible();
		await hostPage.getByRole("button", { name: "Admit all" }).click();

		await expect(guest.page.getByTestId("meeting-layout")).toBeVisible();
		await expect(guest.page.getByTestId("toolbar-end-call")).toBeVisible();
	});

	test("guest in restricted lobby can't join meeting when rejected", async ({
		hostPage,
		restrictedMeetingId,
		createParticipant,
	}) => {
		const meetingId = restrictedMeetingId;
		const guest = await createParticipant();
		const guestName = `Guest Rejected ${test.info().parallelIndex}-${test.info().retry}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toBeVisible();

		const waitingGuestRows = hostPage
			.getByTestId("people-panel")
			.locator("[data-testid^='waiting-user-']")
			.filter({ hasText: guestName });
		const waitingGuestRow = waitingGuestRows.first();

		await expect(waitingGuestRows).toHaveCount(1, {
			timeout: lobbyTransitionTimeout,
		});
		await expect(waitingGuestRow).toBeVisible();
		await waitingGuestRow.locator("[data-testid^='reject-waiting-user-']").click();
		await expect(waitingGuestRows).toHaveCount(0, {
			timeout: lobbyTransitionTimeout,
		});

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });
	});
});