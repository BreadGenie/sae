import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Restricted meeting", () => {
	test("guest waits for approval and host can admit from people panel", async ({
		hostPage,
		restrictedMeetingId,
		createParticipant,
	}) => {
		const meetingId = restrictedMeetingId;
		const guest = await createParticipant();
		const guestName = `Guest Restricted ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(guest.page.getByText("Waiting to be admitted")).toBeVisible();

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
		const guestName = `Guest Rejected ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}?created=true`);
		await joinFromPreview(hostPage);

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(guest.page.getByText("Waiting to be admitted")).toBeVisible();

		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toBeVisible();

		const waitingGuestRow = hostPage
			.getByTestId("people-panel")
			.locator("[data-testid^='waiting-user-']")
			.filter({ hasText: guestName })
			.first();

		await expect(waitingGuestRow).toBeVisible();
		await waitingGuestRow.locator("[data-testid^='reject-waiting-user-']").click();
		await expect(waitingGuestRow).toHaveCount(0);

		await guest.page.goto(`/meet/${meetingId}`);
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible();
	});
});