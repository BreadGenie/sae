import type { Page } from "@playwright/test";
import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function generateE2EEKey(): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const chars: string[] = [];
	for (let i = 0; i < 16; i++) {
		chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
	}
	return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}`;
}

async function convertMeetingToE2EE(
	hostPage: Page,
	meetingId: string,
): Promise<string> {
	const key = generateE2EEKey();
	const keyVersion = `v1-${Math.random().toString(16).slice(2, 10)}`;
	const keyProof = await sha256Hex(`${keyVersion}:${key}`);

	const response = await hostPage.request.post(
		appUrl("/api/method/meet.api.meeting.convert_meeting_to_e2ee"),
		{
			form: {
				meeting_id: meetingId,
				e2ee_key_proof: keyProof,
				e2ee_key_version: keyVersion,
			},
		},
	);
	expect(response.ok()).toBeTruthy();
	return key;
}

test.describe("E2EE", () => {
	test("participants can join with the same key", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guest = await createParticipant();
		const e2eeKey = await convertMeetingToE2EE(hostPage, meetingId);

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage, e2eeKey);
		await guest.joinAsGuest(meetingId, `Guest E2EE ${test.info().parallelIndex}`, e2eeKey);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2);
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2);
	});

	test("cancelling the key dialog shows the join error", async ({
		hostPage,
		createMeeting,
	}) => {
		const meetingId = await createMeeting();
		await convertMeetingToE2EE(hostPage, meetingId);

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await expect(hostPage.getByTestId("meeting-preview")).toBeVisible({
			timeout: 20_000,
		});
		await hostPage.getByTestId("join-meeting-preview-button").click();

		await expect(hostPage.getByTestId("e2ee-key-dialog")).toBeVisible({
			timeout: 20_000,
		});
		await hostPage.getByRole("button", { name: "Cancel" }).click();

		await expect(hostPage.getByText("A valid E2EE key is required to join this meeting.")).toBeVisible({
			timeout: 20_000,
		});
		await expect(hostPage.getByTestId("meeting-layout")).toHaveCount(0);
	});
});
