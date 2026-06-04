import type { APIRequestContext } from "@playwright/test";

type MeetingType = "open" | "restricted";
const baseURL = process.env.BASE_URL ?? "http://localhost:8096";

interface FrappeMethodResponse<T> {
	message?: T;
	exc?: string;
}

export async function createMeetingViaApi(
	request: APIRequestContext,
	meetingType: MeetingType = "open",
): Promise<string> {
	const response = await request.post(
		new URL("/api/method/meet.api.meeting.create", baseURL).toString(),
		{
		data: {
			meeting_type: meetingType,
		},
		},
	);

	if (!response.ok()) {
		const responseBody = await response.text();
		throw new Error(
			`Meeting creation failed with status ${response.status()}: ${responseBody}`,
		);
	}

	const data = (await response.json()) as FrappeMethodResponse<string>;
	const meetingId = data.message;

	if (!meetingId) {
		throw new Error("Meeting creation did not return a meeting id");
	}

	return meetingId;
}

export async function clearMeetingCreateRateLimit(
	request: APIRequestContext,
): Promise<void> {
	await request.post(
		new URL(
			"/api/method/meet.api.test_helpers.clear_create_rate_limit",
			baseURL,
		).toString(),
		{ data: {} },
	);
}

export type { MeetingType };