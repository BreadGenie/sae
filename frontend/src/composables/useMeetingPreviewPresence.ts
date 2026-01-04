import { createResource } from "frappe-ui";
import { type Socket, io } from "socket.io-client";
import { computed, onUnmounted, readonly, ref } from "vue";
import { session } from "../data/session";
import type { FrappeRequestError } from "../types";

interface Participant {
	user_id: string;
	full_name: string;
	avatar_url?: string;
	has_video: boolean;
	has_audio: boolean;
}

interface TokenResponse {
	success: boolean;
	auth_token?: string;
	sfu_url?: string;
	sfu_port?: number;
	error?: string;
}

interface ParticipantResponse {
	success: boolean;
	participants?: Array<{
		id: string;
		user_id?: string;
		info: {
			name?: string;
			userId?: string;
			avatar?: string;
			audio_enabled?: boolean;
			video_enabled?: boolean;
			is_guest?: boolean;
		};
	}>;
	error?: string;
}

interface JoinResponse {
	success: boolean;
	error?: string;
}

interface ParticipantJoinedData {
	roomId: string;
	participantId: string;
	userData: {
		name?: string;
		userId: string;
		avatar?: string;
		audio_enabled: boolean;
		video_enabled: boolean;
	};
}

interface ParticipantLeftData {
	roomId: string;
	participantId: string;
}

export function useMeetingPreviewPresence(meetingId: string) {
	const participants = ref<Participant[]>([]);
	const error = ref<string | null>(null);
	let socket: Socket | null = null;

	const fetchPresenceToken = createResource({
		url: "meet.api.meeting.get_sfu_presence_preview_token",
		params: { meeting_id: meetingId },
		auto: false,
		onSuccess(data: TokenResponse) {
			if (data.success) {
				connectToSFU(data);
			} else {
				error.value = data.error || "Failed to get presence token";
			}
		},
		onError(err: FrappeRequestError) {
			error.value = err.messages.length
				? err.messages.join(", ")
				: "Failed to fetch presence token";
		},
	});

	if (session.isLoggedIn) {
		fetchPresenceToken.fetch();
	}

	const connectToSFU = (tokenData: TokenResponse) => {
		if (!tokenData.sfu_url || !tokenData.auth_token) {
			error.value = "Invalid token data";
			return;
		}

		let sfuUrl: string;
		const urlObj = new URL(tokenData.sfu_url);
		const isSecured = urlObj.protocol === "https:";

		if (isSecured) {
			sfuUrl = urlObj.origin;
		} else {
			sfuUrl = `${urlObj.protocol}//${urlObj.hostname}:${tokenData.sfu_port || 3000}`;
		}

		socket = io(sfuUrl, {
			auth: { token: tokenData.auth_token },
			transports: ["websocket", "polling"],
		});

		// ts doesn't understand that socket is non-null in callbacks
		// we use a local reference to avoid null checks
		const currentSocket = socket;

		currentSocket.on("connect", () => {
			currentSocket.emit(
				"join_room",
				{
					roomId: meetingId,
					userData: {
						name: "Preview",
						userId: `preview-${Date.now()}`,
						avatar: null,
					},
					mediaState: {
						audio_enabled: false,
						video_enabled: false,
					},
				},
				// keep callback since we do evoke it
				(joinResponse: JoinResponse) => {
					if (!joinResponse.success) {
						console.error(
							"Failed to join room for presence preview:",
							joinResponse.error,
						);
					}
				},
			);

			currentSocket.emit(
				"get_room_participants",
				{},
				(response: ParticipantResponse) => {
					if (response.success && response.participants) {
						participants.value = response.participants.map((p) => ({
							user_id: p.info.userId || p.user_id || p.id,
							full_name: p.info.name || p.user_id || p.id,
							avatar_url: p.info.avatar,
							has_video: p.info.video_enabled || false,
							has_audio: p.info.audio_enabled || false,
							is_guest: p.info.is_guest || false,
						}));
					} else {
						error.value = response.error || "Failed to fetch participants";
					}
				},
			);
		});

		currentSocket.on("connect_error", (err: Error) => {
			error.value = err.message || "Failed to connect to SFU";
		});

		currentSocket.on("participant_joined", (data: ParticipantJoinedData) => {
			const newParticipant: Participant = {
				user_id: data.userData.userId,
				full_name: data.userData.name || data.userData.userId,
				avatar_url: data.userData.avatar,
				has_video: data.userData.video_enabled,
				has_audio: data.userData.audio_enabled,
			};

			const existingIndex = participants.value.findIndex(
				(p) => p.user_id === newParticipant.user_id,
			);
			if (existingIndex === -1) {
				participants.value.push(newParticipant);
			}
		});

		currentSocket.on("participant_left", (data: ParticipantLeftData) => {
			if (data.participantId.startsWith("preview-")) {
				return;
			}
			const index = participants.value.findIndex(
				(p) => p.user_id === data.participantId,
			);
			if (index !== -1) {
				participants.value.splice(index, 1);
			}
		});
	};

	const refresh = (): void => {
		error.value = null;
		fetchPresenceToken.fetch();
	};

	// fetchPresenceToken.fetch();

	onUnmounted(() => {
		if (socket) {
			socket.off("participant_joined");
			socket.off("participant_left");
			socket.disconnect();
		}
	});

	return {
		participants: readonly(participants),
		error: readonly(error),
		refresh,
		topParticipants: computed(() => participants.value.slice(0, 3)),
		extraCount: computed(() => Math.max(0, participants.value.length - 3)),
	};
}
