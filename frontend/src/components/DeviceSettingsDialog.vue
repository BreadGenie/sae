<template>
	<Dialog v-model="show" :options="{ title: 'Device Settings' }">
		<template #body-content>
			<div class="space-y-6">
				<div class="">
					<p class="text-sm text-gray-600">
						Select your preferred camera, microphone, and speaker
					</p>
				</div>

				<div class="space-y-2">
					<FormControl
						label="Camera"
						type="autocomplete"
						v-model="selectedCameraIdLocal"
						:options="cameraSelectOptions"
						placeholder="Select camera"
					>
						<template #prefix>
							<lucide-camera class="mr-2 h-4 w-4" />
						</template>
						<template #item-prefix="{ active, selected, option }">
							<lucide-check v-if="selected" class="w-4 h-4" />
						</template>
					</FormControl>
				</div>

				<div class="space-y-2 flex gap-4 items-center">
					<FormControl
						class="w-full"
						label="Microphone"
						type="autocomplete"
						v-model="selectedMicIdLocal"
						:options="micSelectOptions"
						placeholder="Select microphone"
					>
						<template #prefix>
							<FeatherIcon name="mic" class="mr-2 h-4 w-4" />
						</template>
						<template #item-prefix="{ active, selected, option }">
							<lucide-check v-if="selected" class="w-4 h-4" />
						</template>
					</FormControl>

					<div v-if="selectedMicIdLocal" class="w-5">
						<AudioIndicator
							class="mt-2"
							:device-id="selectedMicIdLocal"
							:is-active="show"
							:sensitivity="2"
							:max-height="40"
						/>
					</div>
				</div>

				<div class="space-y-2 flex gap-2">
					<FormControl
						class="w-full"
						label="Speaker"
						type="autocomplete"
						v-model="selectedSpeakerIdLocal"
						:options="speakerSelectOptions"
						placeholder="Select speaker"
					>
						<template #prefix>
							<lucide-speaker class="mr-2 h-4 w-4" />
						</template>
						<template #item-prefix="{ active, selected, option }">
							<lucide-check v-if="selected" class="w-4 h-4" />
						</template>
					</FormControl>

					<div>
						<Button
							class="mt-3"
							v-if="selectedSpeakerIdLocal"
							@click="testSpeaker"
							:loading="isTestingAudio"
							icon-left="volume-2"
						>
							Test
						</Button>
					</div>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Button, Dialog, FeatherIcon, FormControl } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
	setSelectedCameraId,
	setSelectedMicId,
	setSelectedSpeakerId,
} from "../data/mediaPreferences.js";
import { deviceManager } from "../utils/media/DeviceManager.js";
import AudioIndicator from "./AudioIndicator.vue";

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(["device-changed", "update:modelValue"]);

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const selectedCameraIdLocal = ref(selectedCameraId.value);
const selectedMicIdLocal = ref(selectedMicId.value);
const selectedSpeakerIdLocal = ref(selectedSpeakerId.value);

const cameraOptions = ref([]);
const micOptions = ref([]);
const speakerOptions = ref([]);

const isTestingAudio = ref(false);
let testAudio = null;

const cameraSelectOptions = computed(() =>
	cameraOptions.value.map((camera) => ({
		label: camera.label,
		value: camera.deviceId,
		icon: "camera",
	})),
);

const micSelectOptions = computed(() =>
	micOptions.value.map((mic) => ({
		label: mic.label,
		value: mic.deviceId,
		icon: "mic",
	})),
);

const speakerSelectOptions = computed(() =>
	speakerOptions.value.map((speaker) => ({
		label: speaker.label,
		value: speaker.deviceId,
		icon: "volume-2",
	})),
);

// Watch for device changes like plug/unplug or bluetooth connect
watch(selectedCameraIdLocal, (newDeviceId) => {
	// Handle both string and object formats from autocomplete :/
	const deviceId =
		typeof newDeviceId === "object" ? newDeviceId?.value : newDeviceId;

	if (deviceId && deviceId !== selectedCameraId.value) {
		setSelectedCameraId(deviceId);
		emit("device-changed", { type: "camera", deviceId });
		console.log("📹 Camera changed to:", deviceId);
	}
});

watch(selectedMicIdLocal, (newDeviceId) => {
	// Handle both string and object formats from autocomplete
	const deviceId =
		typeof newDeviceId === "object" ? newDeviceId?.value : newDeviceId;

	if (deviceId && deviceId !== selectedMicId.value) {
		setSelectedMicId(deviceId);
		emit("device-changed", { type: "microphone", deviceId });
		console.log("🎤 Microphone changed to:", deviceId);
	}
});

watch(selectedCameraId, (newVal) => {
	selectedCameraIdLocal.value = newVal;
});

watch(selectedMicId, (newVal) => {
	selectedMicIdLocal.value = newVal;
});

watch(selectedSpeakerIdLocal, (newDeviceId) => {
	// Handle both string and object formats from autocomplete
	const deviceId =
		typeof newDeviceId === "object" ? newDeviceId?.value : newDeviceId;

	if (deviceId && deviceId !== selectedSpeakerId.value) {
		setSelectedSpeakerId(deviceId);
		emit("device-changed", { type: "speaker", deviceId });
	}
});

watch(selectedSpeakerId, (newVal) => {
	selectedSpeakerIdLocal.value = newVal;
});

const testSpeaker = async () => {
	if (isTestingAudio.value) return;

	try {
		isTestingAudio.value = true;

		if (testAudio) {
			testAudio.pause();
			testAudio = null;
		}

		const speakerId =
			typeof selectedSpeakerIdLocal.value === "object"
				? selectedSpeakerIdLocal.value?.value
				: selectedSpeakerIdLocal.value;

		const audioContext = new window.AudioContext();

		const oscillator = audioContext.createOscillator();
		const gainNode = audioContext.createGain();

		oscillator.type = "sine";
		oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
		oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.15);

		gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
		gainNode.gain.exponentialRampToValueAtTime(
			0.01,
			audioContext.currentTime + 0.3,
		);

		oscillator.connect(gainNode);
		gainNode.connect(audioContext.destination);

		if (typeof audioContext.setSinkId === "function" && speakerId) {
			try {
				await audioContext.setSinkId(speakerId);
			} catch (error) {
				console.warn("⚠️ Could not set audio context sink:", error);
			}
		}

		oscillator.start(audioContext.currentTime);
		oscillator.stop(audioContext.currentTime + 0.3);

		setTimeout(() => {
			audioContext.close();
			isTestingAudio.value = false;
		}, 500);
	} catch (error) {
		console.error("❌ Failed to test speaker:", error);
		isTestingAudio.value = false;
	}
};

watch(
	() => props.modelValue,
	(isOpen) => {
		if (isOpen) {
			loadDevices();
		} else {
			if (testAudio) {
				testAudio.pause();
				testAudio = null;
				isTestingAudio.value = false;
			}
		}
	},
);

const loadDevices = async () => {
	try {
		await deviceManager.checkExistingPermissions();

		await deviceManager.enumerateDevices({ video: true, audio: true });

		cameraOptions.value = deviceManager.getCameras();
		micOptions.value = deviceManager.getMicrophones();
		speakerOptions.value = deviceManager.getSpeakers();

		// auto select the first available device if none selected
		if (!selectedCameraIdLocal.value && cameraOptions.value.length > 0) {
			selectedCameraIdLocal.value = cameraOptions.value[0].deviceId;
			setSelectedCameraId(selectedCameraIdLocal.value);
		}

		if (!selectedMicIdLocal.value && micOptions.value.length > 0) {
			selectedMicIdLocal.value = micOptions.value[0].deviceId;
			setSelectedMicId(selectedMicIdLocal.value);
		}

		if (!selectedSpeakerIdLocal.value && speakerOptions.value.length > 0) {
			selectedSpeakerIdLocal.value = speakerOptions.value[0].deviceId;
			setSelectedSpeakerId(selectedSpeakerIdLocal.value);
		}
	} catch (error) {
		console.error("❌ Failed to load devices:", error);
	}
};

onMounted(() => {
	if (show.value) {
		loadDevices();
	}

	const handleDeviceChange = () => {
		const oldCameraOptions = cameraOptions.value;
		const oldMicOptions = micOptions.value;
		const oldSpeakerOptions = speakerOptions.value;

		cameraOptions.value = deviceManager.getCameras();
		micOptions.value = deviceManager.getMicrophones();
		speakerOptions.value = deviceManager.getSpeakers();

		// check for newly connected devices
		const newCameras = cameraOptions.value.filter(
			(cam) =>
				!oldCameraOptions.some((oldCam) => oldCam.deviceId === cam.deviceId),
		);
		const newMics = micOptions.value.filter(
			(mic) =>
				!oldMicOptions.some((oldMic) => oldMic.deviceId === mic.deviceId),
		);
		const newSpeakers = speakerOptions.value.filter(
			(speaker) =>
				!oldSpeakerOptions.some(
					(oldSpeaker) => oldSpeaker.deviceId === speaker.deviceId,
				),
		);

		console.log("Newly connected devices:", {
			cameras: newCameras.map((c) => ({ id: c.deviceId, label: c.label })),
			microphones: newMics.map((m) => ({ id: m.deviceId, label: m.label })),
			speakers: newSpeakers.map((s) => ({ id: s.deviceId, label: s.label })),
		});

		// clear selection if the selected device is no longer available
		if (
			selectedCameraIdLocal.value &&
			!deviceManager.findDeviceById(selectedCameraIdLocal.value, "camera")
		) {
			selectedCameraIdLocal.value = "";
		}
		if (
			selectedMicIdLocal.value &&
			!deviceManager.findDeviceById(selectedMicIdLocal.value, "microphone")
		) {
			selectedMicIdLocal.value = "";
		}
		if (
			selectedSpeakerIdLocal.value &&
			!deviceManager.findDeviceById(selectedSpeakerIdLocal.value, "speaker")
		) {
			selectedSpeakerIdLocal.value = "";
		}

		// auto select newly connected devices if none selected
		if (newCameras.length > 0 && !selectedCameraIdLocal.value) {
			selectedCameraIdLocal.value = newCameras[0].deviceId;
			setSelectedCameraId(selectedCameraIdLocal.value);
			emit("device-changed", {
				type: "camera",
				deviceId: selectedCameraIdLocal.value,
			});
		}
		if (newMics.length > 0 && !selectedMicIdLocal.value) {
			selectedMicIdLocal.value = newMics[0].deviceId;
			setSelectedMicId(selectedMicIdLocal.value);
			emit("device-changed", {
				type: "microphone",
				deviceId: selectedMicIdLocal.value,
			});
			console.log("🎤 Auto-selected new microphone:", newMics[0].label);
		} else if (newMics.length > 0 && selectedMicIdLocal.value) {
			// if we already have a mic selected, still switch to the new one
			selectedMicIdLocal.value = newMics[0].deviceId;
			setSelectedMicId(selectedMicIdLocal.value);
			emit("device-changed", {
				type: "microphone",
				deviceId: selectedMicIdLocal.value,
			});
		}
		if (newSpeakers.length > 0 && !selectedSpeakerIdLocal.value) {
			selectedSpeakerIdLocal.value = newSpeakers[0].deviceId;
			setSelectedSpeakerId(selectedSpeakerIdLocal.value);
			emit("device-changed", {
				type: "speaker",
				deviceId: selectedSpeakerIdLocal.value,
			});
		}
	};

	deviceManager.addDeviceChangeListener(handleDeviceChange);

	onUnmounted(() => {
		deviceManager.removeDeviceChangeListener(handleDeviceChange);
	});
});
</script>
