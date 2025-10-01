import { ref } from "vue";

function readBool(key, def = true) {
	const v = localStorage.getItem(key);
	if (v === null) return def;
	return v === "1";
}

function readString(key, def = "") {
	const v = localStorage.getItem(key);
	return v !== null ? v : def;
}

export const micEnabled = ref(readBool("mediaPref.mic", true));
export const cameraEnabled = ref(readBool("mediaPref.camera", true));
export const selectedCameraId = ref(readString("mediaPref.cameraId", ""));
export const selectedMicId = ref(readString("mediaPref.micId", ""));
export const selectedSpeakerId = ref(readString("mediaPref.speakerId", ""));

export function setMicEnabled(val) {
	micEnabled.value = !!val;
	try {
		localStorage.setItem("mediaPref.mic", micEnabled.value ? "1" : "0");
	} catch (_) {}
}

export function setCameraEnabled(val) {
	cameraEnabled.value = !!val;
	try {
		localStorage.setItem("mediaPref.camera", cameraEnabled.value ? "1" : "0");
	} catch (_) {}
}

export function setSelectedCameraId(deviceId) {
	selectedCameraId.value = deviceId || "";
	try {
		localStorage.setItem("mediaPref.cameraId", selectedCameraId.value);
	} catch (_) {}
}

export function setSelectedMicId(deviceId) {
	selectedMicId.value = deviceId || "";
	try {
		localStorage.setItem("mediaPref.micId", selectedMicId.value);
	} catch (_) {}
}

export function setSelectedSpeakerId(deviceId) {
	selectedSpeakerId.value = deviceId || "";
	try {
		localStorage.setItem("mediaPref.speakerId", selectedSpeakerId.value);
	} catch (_) {}
}

export function loadMediaPreferences() {
	micEnabled.value = readBool("mediaPref.mic", true);
	cameraEnabled.value = readBool("mediaPref.camera", true);
	selectedCameraId.value = readString("mediaPref.cameraId", "");
	selectedSpeakerId.value = readString("mediaPref.speakerId", "");
	selectedMicId.value = readString("mediaPref.micId", "");
}
