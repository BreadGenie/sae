<template>
	<div class="flex items-center gap-1" :style="{ height: (props.maxHeight || 80) + 'px' }">
		<div
			v-for="(bar, index) in bars"
			:key="index"
			class="audio-bar"
			:style="{
				height: bar.height + 'px',
				maxHeight: (props.maxHeight || 80) + 'px',
				backgroundColor: bar.color,
				transition: 'height 0.1s ease-out, background-color 0.1s ease-out',
			}"
		></div>
	</div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({
	deviceId: {
		type: String,
		required: false,
		default: "",
	},
	isActive: {
		type: Boolean,
		default: false,
	},
	sensitivity: {
		type: Number,
		default: 1.0,
	},
	maxHeight: {
		type: Number,
		default: 80,
	},
});

const bars = ref(
	Array.from({ length: 3 }, () => ({
		height: 4,
		color: "#e5e7eb",
	})),
);

let audioContext = null;
let analyser = null;
let microphone = null;
let animationFrame = null;
let isListening = false;
let mediaStream = null;

const startListening = async () => {
	if (isListening || !props.isActive) return;

	try {
		isListening = true;

		mediaStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				deviceId: props.deviceId,
				echoCancellation: true,
				noiseSuppression: true,
			},
		});

		audioContext = new window.AudioContext();
		analyser = audioContext.createAnalyser();
		microphone = audioContext.createMediaStreamSource(mediaStream);

		// We do RMS (root mean square) analysis on the time-domain signal
		// to get a better representation of perceived loudness.

		// how does it work?

		// it works by taking the square of each sample, averaging those squares,
		// and then taking the square root of that average. This gives us a value (in the 0..1 range)
		// that represents the "loudness" of the signal more accurately than
		// simply using the peak amplitude.

		// Use a larger time-domain buffer cuz it'll be smoother
		analyser.fftSize = 2048;
		const bufferLength = analyser.fftSize;
		const timeData = new Uint8Array(bufferLength);

		microphone.connect(analyser);

		// Per-bar smoothing state (persistent between frames)
		const numBars = bars.value.length;
		const smoothedLevels = new Array(numBars).fill(0);
		const maxHeight = props.maxHeight || 80; // px (capped by prop)

		// Animation loop (global RMS -> per-bar center-weighted -> smoothing)
		const animate = () => {
			if (!analyser) return;

			analyser.getByteTimeDomainData(timeData);

			// Compute global RMS across the whole buffer
			let sumSquaresAll = 0;
			for (let j = 0; j < bufferLength; j++) {
				const v = (timeData[j] - 128) / 128;
				sumSquaresAll += v * v;
			}
			const globalRms = Math.sqrt(sumSquaresAll / (bufferLength || 1)); // 0..~1

			const time = Date.now() * 0.004;
			const centerPos = (numBars - 1) / 2;

			for (let i = 0; i < numBars; i++) {
				// distance-based center bias (0.6..1.0)
				const distNorm = Math.abs(i - centerPos) / (centerPos || 1);
				const centerBias = 0.6 + (1 - distNorm) * 0.4; // 0.6..1.0

				// Slight organic wobble
				const organic = Math.sin(time + i * 0.22) * 0.09 + 0.96; // ~0.87..1.05

				// Amplify low-level signals using a sqrt curve so quiet sounds show up
				// Blend sqrt and linear to preserve dynamics, then apply biases
				const amplified = Math.sqrt(globalRms) * 0.95 + globalRms * 0.05;
				const target =
					(amplified * centerBias * organic + 0.01) * props.sensitivity;

				// Apply exponential smoothing to make it less jittery
				const responsiveSmoothing = 0.62; // lower -> more responsive to quiet sounds
				smoothedLevels[i] =
					smoothedLevels[i] * responsiveSmoothing +
					target * (1 - responsiveSmoothing);

				const displayHeight = Math.max(
					4,
					Math.min(maxHeight, smoothedLevels[i] * maxHeight),
				);
				const color = smoothedLevels[i] > 0.02 ? "#e54e17" : "#e5e7eb";

				bars.value[i] = { height: displayHeight, color };
			}

			animationFrame = requestAnimationFrame(animate);
		};

		animate();
	} catch (error) {
		console.warn("Failed to start audio monitoring:", error);
		isListening = false;

		bars.value = bars.value.map(() => ({
			height: 4,
			color: "#e5e7eb",
		}));
	}
};

const stopListening = () => {
	if (!isListening) return;

	isListening = false;

	if (animationFrame) {
		cancelAnimationFrame(animationFrame);
		animationFrame = null;
	}

	if (microphone) {
		microphone.disconnect();
		microphone = null;
	}

	if (mediaStream) {
		for (const track of mediaStream.getTracks()) {
			track.stop();
		}
		mediaStream = null;
	}

	if (audioContext && audioContext.state !== "closed") {
		audioContext.close();
		audioContext = null;
	}

	analyser = null;

	bars.value = bars.value.map(() => ({
		height: 4,
		color: "#e5e7eb",
	}));
};

// Watch for device changes
watch(
	() => props.deviceId,
	() => {
		stopListening();
		if (props.isActive) {
			startListening();
		}
	},
);

// Watch for active state
watch(
	() => props.isActive,
	(active) => {
		if (active) {
			startListening();
		} else {
			stopListening();
		}
	},
);

onMounted(() => {
	if (props.isActive) {
		startListening();
	}
});

onUnmounted(() => {
	stopListening();
});
</script>

<style scoped>
.audio-bar {
	width: 3px;
	border-radius: 1px;
	transition:
		height 0.1s ease-out,
		background-color 0.1s ease-out;
}
</style>
