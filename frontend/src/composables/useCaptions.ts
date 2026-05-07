import { onMounted, onUnmounted } from "vue";
import type { SFUClient } from "../utils/SFUClient";
import { useCaptionStore } from "./useCaptionStore";

const CAPTION_AUTO_HIDE_MS = 6000;

export function useCaptions(deps: { sfuClient: SFUClient }) {
	const { sfuClient } = deps;
	const captionStore = useCaptionStore();
	let captionHideTimer: ReturnType<typeof setTimeout> | null = null;

	const clearCaptionTimer = () => {
		if (captionHideTimer) {
			clearTimeout(captionHideTimer);
			captionHideTimer = null;
		}
	};

	const scheduleCaptionHide = () => {
		clearCaptionTimer();
		captionHideTimer = setTimeout(() => {
			captionStore.clearCaptionLines();
		}, CAPTION_AUTO_HIDE_MS);
	};

	const handleSttSegment = (data: Record<string, unknown>) => {
		const segment = data?.segment as Record<string, unknown> | undefined;
		if (!segment) return;
		captionStore.addCaptionLine({
			participantId: segment.participantId as string,
			participantName:
				(segment.participantName as string) ||
				(segment.participantId as string),
			text: segment.text as string,
			timestamp: segment.timestamp as string,
			isFinal: segment.isFinal as boolean | undefined,
		});
		scheduleCaptionHide();
	};

	const toggleCaptions = async () => {
		if (!sfuClient.isConnected()) return;

		const newEnabled = !captionStore.isCaptionsEnabled;
		try {
			await sfuClient.sendRequest("stt:toggle", {
				enabled: newEnabled,
			});
			captionStore.setCaptionsEnabled(newEnabled);
			if (!newEnabled) {
				captionStore.clearCaptionLines();
			}
		} catch (error) {
			console.error("Failed to toggle captions:", error);
		}
	};

	onMounted(() => {
		sfuClient.on("stt:segment", handleSttSegment);
	});

	onUnmounted(() => {
		sfuClient.off("stt:segment");
		clearCaptionTimer();
	});

	return {
		toggleCaptions,
	};
}
