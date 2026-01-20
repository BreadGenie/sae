export type Platform = "win" | "mac" | "linux" | "unknown";

export interface FrappeRequestError extends Error {
	messages: string[];
}

export interface Participant {
	user_id: string;
	user_name?: string;
	avatar?: string;
	initials?: string;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
}

export interface ParticipantPreview {
	user_id: string;
	full_name: string;
	avatar_url?: string;
	has_video: boolean;
	has_audio: boolean;
}
