<template>
	<Dialog v-model="show" :options="{ title: 'Device Settings' }">
		<template #body-content>
			<div class="space-y-6">
				<div class="">
					<p class="text-sm text-gray-600">
						Select your preferred camera and microphone
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
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { Dialog, FeatherIcon, FormControl } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
	selectedCameraId,
	selectedMicId,
	setSelectedCameraId,
	setSelectedMicId,
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

const cameraOptions = ref([]);
const micOptions = ref([]);

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

// Watch for device changes like plug/unplug or bluetooth connect
watch(selectedCameraIdLocal, (newDeviceId) => {
	if (newDeviceId !== selectedCameraId.value) {
		setSelectedCameraId(newDeviceId);
		emit("device-changed", { type: "camera", deviceId: newDeviceId });
	}
});

watch(selectedMicIdLocal, (newDeviceId) => {
	if (newDeviceId !== selectedMicId.value) {
		setSelectedMicId(newDeviceId);
		emit("device-changed", { type: "microphone", deviceId: newDeviceId });
	}
});

watch(selectedCameraId, (newVal) => {
	selectedCameraIdLocal.value = newVal;
});

watch(selectedMicId, (newVal) => {
	selectedMicIdLocal.value = newVal;
});

watch(
	() => props.modelValue,
	(isOpen) => {
		if (isOpen) {
			loadDevices();
		}
	},
);

const loadDevices = async () => {
	try {
		await deviceManager.enumerateDevices();

		cameraOptions.value = deviceManager.getCameras();
		micOptions.value = deviceManager.getMicrophones();

		// auto select the first available device if none selected
		if (!selectedCameraIdLocal.value && cameraOptions.value.length > 0) {
			selectedCameraIdLocal.value = cameraOptions.value[0].deviceId;
			setSelectedCameraId(selectedCameraIdLocal.value);
		}

		if (!selectedMicIdLocal.value && micOptions.value.length > 0) {
			selectedMicIdLocal.value = micOptions.value[0].deviceId;
			setSelectedMicId(selectedMicIdLocal.value);
		}
	} catch (error) {
		console.error("❌ Failed to load devices:", error);
	}
};

onMounted(() => {
	loadDevices();

	const handleDeviceChange = () => {
		const oldCameraOptions = cameraOptions.value;
		const oldMicOptions = micOptions.value;

		cameraOptions.value = deviceManager.getCameras();
		micOptions.value = deviceManager.getMicrophones();

		// check for newly connected devices
		const newCameras = cameraOptions.value.filter(
			(cam) =>
				!oldCameraOptions.some((oldCam) => oldCam.deviceId === cam.deviceId),
		);
		const newMics = micOptions.value.filter(
			(mic) =>
				!oldMicOptions.some((oldMic) => oldMic.deviceId === mic.deviceId),
		);

		console.log("Newly connected devices:", {
			cameras: newCameras.map((c) => ({ id: c.deviceId, label: c.label })),
			microphones: newMics.map((m) => ({ id: m.deviceId, label: m.label })),
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
			console.log(
				"Clearing invalid microphone selection:",
				selectedMicIdLocal.value,
			);
			selectedMicIdLocal.value = "";
		}

		// auto select newly connected devices if none selected
		if (newCameras.length > 0 && !selectedCameraIdLocal.value) {
			selectedCameraIdLocal.value = newCameras[0].deviceId;
			setSelectedCameraId(selectedCameraIdLocal.value);
			emit("device-changed", {
				type: "camera",
				deviceId: selectedCameraIdLocal.value,
			});
			console.log("📹 Auto-selected new camera:", newCameras[0].label);
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
	};

	deviceManager.addDeviceChangeListener(handleDeviceChange);

	onUnmounted(() => {
		deviceManager.removeDeviceChangeListener(handleDeviceChange);
	});
});
</script>
