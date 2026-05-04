import { onMounted, onUnmounted, ref } from "vue";
import { getSFUMeetingManager } from "../utils/sfu-meeting-manager.js";
import type { CurrentUser } from "./useCurrentUser";
import type { MediaState } from "./useMediaState";

export function useAudioStream(
	participantId: string,
	deps: {
		mediaState: MediaState;
		currentUser: CurrentUser;
	},
) {
	const stream = ref<MediaStream | null>(null);
	const { mediaState, currentUser } = deps;

	const getStream = () => {
		try {
			if (
				participantId ===
				(currentUser.currentUser.value as Record<string, unknown>)?.user_id
			) {
				const audioTrack = mediaState.localStream.value?.getAudioTracks()[0];
				if (audioTrack) {
					stream.value = new MediaStream([audioTrack]);
				}
			} else {
				const sfuManager = getSFUMeetingManager();
				if (sfuManager?.consumerManager) {
					const audioConsumer =
						sfuManager.consumerManager.getAudioConsumer(participantId);
					if (audioConsumer?.track) {
						stream.value = new MediaStream([audioConsumer.track]);
						return;
					}
				}

				if (sfuManager?.videoManager) {
					const audioElement =
						sfuManager.videoManager.audioElements.get(participantId);
					if (audioElement?.srcObject) {
						stream.value = audioElement.srcObject;
					}
				}
			}
		} catch (error) {
			console.error("Error getting audio stream:", error);
		}
	};

	onMounted(() => {
		getStream();
		const interval = setInterval(getStream, 1000);
		onUnmounted(() => clearInterval(interval));
	});

	return { stream };
}
