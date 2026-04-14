import type { APIRequestContext } from "@playwright/test";

type MeetingType = "open" | "restricted";

interface FrappeMethodResponse<T> {
	message?: T;
	exc?: string;
}

export async function createMeetingViaApi(
	request: APIRequestContext,
	meetingType: MeetingType = "open",
): Promise<string> {
	const response = await request.post("/api/method/meet.api.meeting.create", {
		form: {
			meeting_type: meetingType,
			allow_guest: true,
		},
	});

	if (!response.ok()) {
		throw new Error(`Meeting creation failed with status ${response.status()}`);
	}

	const data = (await response.json()) as FrappeMethodResponse<string>;
	const meetingId = data.message;

	if (!meetingId) {
		throw new Error("Meeting creation did not return a meeting id");
	}

	return meetingId;
}

export type { MeetingType };