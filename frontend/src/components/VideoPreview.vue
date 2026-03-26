<template>
	<div class="relative">
		<div class="bg-gray-900 rounded-lg overflow-hidden shadow-lg aspect-video relative">
			<video
				ref="videoElement"
				autoplay
				muted
				playsinline
				class="w-full h-full object-cover transform scale-x-[-1]"
			/>
			<div
				v-if="!videoTrack"
				class="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center"
			>
				<div class="text-white text-center">
					<MeetingAvatar
						:label="userInitials"
						:image="userAvatar"
						:tiles="videoPreviewTiles"
						class="mx-auto mb-4"
					/>
					<p class="text-lg font-medium">{{ userName }}</p>
				</div>
			</div>
		</div>

		<!-- Floating controls overlaid on video -->
		<PreviewToolbar
			:is-mic-on="!isMuted"
			:is-camera-on="!isVideoOff"
			@toggle-microphone="toggleMute"
			@toggle-camera="toggleVideo"
		/>
	</div>
</template>

<script setup>
import {
	cameraEnabled,
	micEnabled,
	setCameraEnabled,
	setMicEnabled,
} from "@/data/mediaPreferences";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useBackgroundEffects } from "../composables/useBackgroundEffects";
import {
	backgroundBlurEnabled,
	backgroundImageEnabled,
	blurIntensity,
	selectedBackgroundImage,
} from "../data/backgroundEffects";
import MeetingAvatar from "./MeetingAvatar.vue";
import PreviewToolbar from "./PreviewToolbar.vue";

const props = defineProps({
	cameraDeviceId: {
		type: String,
		default: null,
	},
});

const videoElement = ref(null);
const isMuted = ref(!micEnabled.value);
const isVideoOff = ref(!cameraEnabled.value);

const audioTrack = ref(null);
const videoTrack = ref(null);
const composedStream = ref(null);

const userName = ref("You");
const userInitials = ref("Y");
const userAvatar = ref("");
// When preview is shown in different layouts this helps scale placeholder
const videoPreviewTiles = 1;

// Background effects
const { applyBackgroundEffects, stopProcessing } = useBackgroundEffects();
let currentSession = null;
let currentSourceTrackId = null;

async function rebuildStream() {
	const tracks = [];
	if (videoTrack.value) tracks.push(videoTrack.value);
	if (audioTrack.value) tracks.push(audioTrack.value);
	if (!tracks.length) {
		stopProcessing();
		if (currentSession) {
			currentSession.cleanup();
			currentSession = null;
			currentSourceTrackId = null;
		}
		composedStream.value = null;
		if (videoElement.value) {
			videoElement.value.srcObject = null;
		}
		return;
	}

	const shouldUseBackground =
		(backgroundBlurEnabled.value || backgroundImageEnabled.value) &&
		videoTrack.value;
	const blurOptions = {
		backgroundBlurEnabled: backgroundBlurEnabled.value,
		backgroundImageEnabled: backgroundImageEnabled.value,
		selectedBackgroundImage: selectedBackgroundImage.value || null,
		blurIntensity: blurIntensity.value,
	};

	if (shouldUseBackground && videoTrack.value) {
		const sourceTrackId = videoTrack.value.id;

		if (currentSession && currentSourceTrackId === sourceTrackId) {
			try {
				await currentSession.updateOptions(blurOptions);
			} catch (error) {
				console.error("Failed to update existing background session:", error);
				stopProcessing();
				currentSession.cleanup();
				currentSession = null;
				currentSourceTrackId = null;
			}
		}

		if (!currentSession) {
			stopProcessing();

			const originalStream = new MediaStream(tracks);

			try {
				currentSession = await applyBackgroundEffects(
					originalStream,
					blurOptions,
				);
				currentSourceTrackId = sourceTrackId;
				composedStream.value = currentSession.stream;
			} catch (error) {
				console.error("Failed to apply background effects:", error);
				currentSession = null;
				currentSourceTrackId = null;
				composedStream.value = originalStream;
			}
		} else {
			composedStream.value = currentSession.stream;
		}
	} else {
		stopProcessing();
		if (currentSession) {
			currentSession.cleanup();
			currentSession = null;
		}
		currentSourceTrackId = videoTrack.value ? videoTrack.value.id : null;
		const originalStream = new MediaStream(tracks);
		composedStream.value = originalStream;
	}

	if (videoElement.value) {
		if (composedStream.value) {
			if (videoElement.value.srcObject !== composedStream.value) {
				videoElement.value.srcObject = composedStream.value;
			}
		} else {
			videoElement.value.srcObject = null;
		}
	}
}

async function acquire(kind) {
	try {
		if (kind === "video" && !videoTrack.value) {
			const constraints = {
				video: {
					width: { ideal: 1280, min: 960 },
					height: { ideal: 720, min: 540 },
					frameRate: { ideal: 30, max: 30 },
					...(props.cameraDeviceId
						? { deviceId: { exact: props.cameraDeviceId } }
						: {}),
				},
				audio: false,
			};
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			videoTrack.value = stream.getVideoTracks()[0] || null;
			if (videoTrack.value)
				videoTrack.value.onended = () => {
					videoTrack.value = null;
					rebuildStream();
				};
		} else if (kind === "audio" && !audioTrack.value) {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});
			audioTrack.value = stream.getAudioTracks()[0] || null;
			if (audioTrack.value)
				audioTrack.value.onended = () => {
					audioTrack.value = null;
					rebuildStream();
				};
		}
		rebuildStream();
	} catch (err) {
		console.error(`Error acquiring ${kind} track:`, err);
		// Revert toggle state on failure
		if (kind === "video") isVideoOff.value = true;
		else isMuted.value = true;
	}
}

async function acquireBoth() {
	try {
		const constraints = {
			audio: true,
			video: {
				width: { ideal: 1280, min: 960 },
				height: { ideal: 720, min: 540 },
				frameRate: { ideal: 30, max: 30 },
				...(props.cameraDeviceId
					? { deviceId: { exact: props.cameraDeviceId } }
					: {}),
			},
		};
		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		videoTrack.value = stream.getVideoTracks()[0] || null;
		audioTrack.value = stream.getAudioTracks()[0] || null;
		if (videoTrack.value)
			videoTrack.value.onended = () => {
				videoTrack.value = null;
				rebuildStream();
			};
		if (audioTrack.value)
			audioTrack.value.onended = () => {
				audioTrack.value = null;
				rebuildStream();
			};
		rebuildStream();
	} catch (err) {
		console.error("Error acquiring audio+video:", err);
		if (err && err.name === "NotAllowedError") {
			// Reflect denied permissions in UI
			isVideoOff.value = true;
			isMuted.value = true;
		}
	}
}

function stopTrack(kind) {
	const t = kind === "video" ? videoTrack : audioTrack;
	if (t.value) {
		t.value.stop();
		t.value = null;
	}
	rebuildStream();
}

async function toggleVideo() {
	if (isVideoOff.value) {
		isVideoOff.value = false;
		await acquire("video");
	} else {
		isVideoOff.value = true;
		stopTrack("video");
	}
	setCameraEnabled(!isVideoOff.value);
}

async function toggleMute() {
	if (isMuted.value) {
		isMuted.value = false;
		await acquire("audio");
	} else {
		isMuted.value = true;
		stopTrack("audio");
	}
	setMicEnabled(!isMuted.value);
}

const handleKeyDown = (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key === "d") {
		event.preventDefault();
		toggleMute();
	}
	if ((event.metaKey || event.ctrlKey) && event.key === "e") {
		event.preventDefault();
		toggleVideo();
	}
};

onMounted(() => {
	// Only acquire what user has enabled in preferences
	if (!isMuted.value && !isVideoOff.value) {
		acquireBoth();
	} else {
		if (!isMuted.value) acquire("audio");
		if (!isVideoOff.value) acquire("video");
	}
	window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
	stopTrack("video");
	stopTrack("audio");
	if (currentSession) {
		currentSession.cleanup();
		currentSession = null;
	}
	stopProcessing();
	window.removeEventListener("keydown", handleKeyDown);
});

// Watch for camera device changes
watch(
	() => props.cameraDeviceId,
	(newDeviceId, oldDeviceId) => {
		if (newDeviceId !== oldDeviceId && videoTrack.value) {
			// Stop current video track
			stopTrack("video");
			// Acquire new video track with new device
			if (!isVideoOff.value) {
				acquire("video");
			}
		}
	},
);

watch(
	[
		backgroundBlurEnabled,
		backgroundImageEnabled,
		selectedBackgroundImage,
		blurIntensity,
	],
	() => {
		rebuildStream();
	},
);
</script>
