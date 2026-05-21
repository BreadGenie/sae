import { defineStore } from "pinia";
import { ref } from "vue";

interface CaptionLine {
	participantId: string;
	participantName: string;
	text: string;
	timestamp: string;
	isFinal?: boolean;
}

interface CaptionSegment {
	participantId: string;
	participantName?: string;
	text: string;
	timestamp: string;
	isFinal?: boolean;
}

export const useCaptionStore = defineStore("caption", () => {
	const isCaptionsEnabled = ref(false);
	const captionLines = ref<CaptionLine[]>([]);

	function addCaptionLine(segment: CaptionSegment) {
		const maxLines = 2;
		const text = segment.text?.trim() || "";

		const existingIndex = captionLines.value.findIndex(
			(l) => l.participantId === segment.participantId && !l.isFinal,
		);

		if (segment.isFinal && !text) {
			const idx = captionLines.value.findIndex(
				(l) => l.participantId === segment.participantId,
			);
			if (idx >= 0) {
				captionLines.value.splice(idx, 1);
			}
			return;
		}

		const line: CaptionLine = {
			participantId: segment.participantId,
			participantName: segment.participantName || segment.participantId,
			text: segment.text,
			timestamp: segment.timestamp,
		};

		if (existingIndex >= 0) {
			captionLines.value.splice(existingIndex, 1, {
				...line,
				isFinal: segment.isFinal,
			});
		} else {
			captionLines.value.push({ ...line, isFinal: segment.isFinal });
		}

		if (captionLines.value.length > maxLines) {
			captionLines.value = captionLines.value.slice(-maxLines);
		}
	}

	function clearCaptionLines() {
		captionLines.value = [];
	}

	function setCaptionsEnabled(enabled: boolean) {
		isCaptionsEnabled.value = enabled;
	}

	function $reset() {
		isCaptionsEnabled.value = false;
		captionLines.value = [];
	}

	return {
		isCaptionsEnabled,
		captionLines,
		addCaptionLine,
		clearCaptionLines,
		setCaptionsEnabled,
		$reset,
	};
});
