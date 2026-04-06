import type { UserData } from "../../types";

export type Platform = "win" | "mac" | "linux" | "unknown";

export interface FrappeRequestError extends Error {
	messages: string[];
}

export interface Participant {
	user_id: string;
	user_name?: string;
	avatar?: UserData["avatar"];
	initials?: string;
	audio_enabled?: UserData["audio_enabled"];
	video_enabled?: UserData["video_enabled"];
	is_guest?: UserData["is_guest"];
}

export interface ParticipantPreview {
	user_id: string;
	full_name: string;
	avatar_url?: string;
	has_video: boolean;
	has_audio: boolean;
	is_guest?: boolean;
}

export type {
	ParticipantInfo,
	ParticipantJoinedEvent,
	ParticipantLeftEvent,
	PresenceJoinResponse,
	PresenceParticipantsResponse,
	PresenceTokenResponse,
	PreviewParticipantInfo,
	UserData,
} from "../../types";
