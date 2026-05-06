export type Platform = "win" | "mac" | "linux" | "unknown";

export interface FrappeRequestError extends Error {
	messages: string[];
	exc_type: string;
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
	ParticipantJoinedEvent,
	ParticipantLeftEvent,
	PresenceJoinResponse,
	PresenceParticipantsResponse,
	PresenceTokenResponse,
} from "../../types";

declare module "vue" {
	interface ComponentCustomProperties {
		$platform: Platform;
	}
}
