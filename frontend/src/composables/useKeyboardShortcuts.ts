import { pushToTalkEnabled } from "../data/mediaPreferences";
import type { MediaState } from "./useMediaState";

interface KeyboardShortcutsAPI {
	handleKeyDown: (event: KeyboardEvent) => void;
	handleKeyUp: (event: KeyboardEvent) => void;
}

export function useKeyboardShortcuts(deps: {
	mediaControls: {
		toggleMicrophone: () => Promise<void>;
		toggleCamera: () => Promise<void>;
	};
	mediaState: MediaState;
}): KeyboardShortcutsAPI {
	const { mediaControls, mediaState } = deps;

	let unmutedByPushToTalk = false;

	const handleKeyDown = (event: KeyboardEvent) => {
		const targetTag = (event.target as HTMLElement)?.tagName?.toLowerCase();
		const isInput =
			targetTag === "input" ||
			targetTag === "textarea" ||
			(event.target as HTMLElement)?.isContentEditable;

		if (
			pushToTalkEnabled.value &&
			event.code === "Space" &&
			!isInput &&
			!event.repeat
		) {
			event.preventDefault();
			if (!mediaState.isMicOn.value) {
				unmutedByPushToTalk = true;
				mediaControls.toggleMicrophone();
			}
		}

		if ((event.metaKey || event.ctrlKey) && event.key === "d") {
			event.preventDefault();
			mediaControls.toggleMicrophone();
		}
		if ((event.metaKey || event.ctrlKey) && event.key === "e") {
			event.preventDefault();
			mediaControls.toggleCamera();
		}
	};

	const handleKeyUp = (event: KeyboardEvent) => {
		const targetTag = (event.target as HTMLElement)?.tagName?.toLowerCase();
		const isInput =
			targetTag === "input" ||
			targetTag === "textarea" ||
			(event.target as HTMLElement)?.isContentEditable;

		if (pushToTalkEnabled.value && event.code === "Space" && !isInput) {
			if (unmutedByPushToTalk) {
				unmutedByPushToTalk = false;
				if (mediaState.isMicOn.value) {
					mediaControls.toggleMicrophone();
				}
			}
		}
	};

	return {
		handleKeyDown,
		handleKeyUp,
	};
}
