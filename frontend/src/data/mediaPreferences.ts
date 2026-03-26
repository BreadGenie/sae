import { type Ref, ref } from "vue";

function readBool(key: string, def = true): boolean {
	const v = localStorage.getItem(key);
	if (v === null) return def;
	return v === "1";
}

function readString(key: string, def = ""): string {
	const v = localStorage.getItem(key);
	return v !== null ? v : def;
}

export const micEnabled: Ref<boolean> = ref(readBool("mediaPref.mic", false));
export const cameraEnabled: Ref<boolean> = ref(
	readBool("mediaPref.camera", false),
);
export const selectedCameraId: Ref<string> = ref(
	readString("mediaPref.cameraId", ""),
);
export const selectedMicId: Ref<string> = ref(
	readString("mediaPref.micId", ""),
);
export const selectedSpeakerId: Ref<string> = ref(
	readString("mediaPref.speakerId", ""),
);
export const noiseCancellationEnabled: Ref<boolean> = ref(
	readBool("mediaPref.noiseCancellation", false),
);

export const pushToTalkEnabled: Ref<boolean> = ref(
	readBool("mediaPref.pushToTalk", false),
);

export const autoHideToolbar: Ref<boolean> = ref(
	readBool("mediaPref.autoHideToolbar", true),
);

export function setNoiseCancellationEnabled(val: boolean): void {
	noiseCancellationEnabled.value = !!val;
	localStorage.setItem(
		"mediaPref.noiseCancellation",
		noiseCancellationEnabled.value ? "1" : "0",
	);
}

export function setPushToTalkEnabled(val: boolean): void {
	pushToTalkEnabled.value = !!val;
	localStorage.setItem(
		"mediaPref.pushToTalk",
		pushToTalkEnabled.value ? "1" : "0",
	);
}

export function setAutoHideToolbar(val: boolean): void {
	autoHideToolbar.value = !!val;
	localStorage.setItem(
		"mediaPref.autoHideToolbar",
		autoHideToolbar.value ? "1" : "0",
	);
}

export function setMicEnabled(val: boolean): void {
	micEnabled.value = !!val;
	localStorage.setItem("mediaPref.mic", micEnabled.value ? "1" : "0");
}

export function setCameraEnabled(val: boolean): void {
	cameraEnabled.value = !!val;
	localStorage.setItem("mediaPref.camera", cameraEnabled.value ? "1" : "0");
}

export function setSelectedCameraId(deviceId: string): void {
	selectedCameraId.value = deviceId || "";
	localStorage.setItem("mediaPref.cameraId", selectedCameraId.value);
}

export function setSelectedMicId(deviceId: string): void {
	selectedMicId.value = deviceId || "";
	localStorage.setItem("mediaPref.micId", selectedMicId.value);
}

export function setSelectedSpeakerId(deviceId: string): void {
	selectedSpeakerId.value = deviceId || "";
	localStorage.setItem("mediaPref.speakerId", selectedSpeakerId.value);
}

export function loadMediaPreferences(): void {
	micEnabled.value = readBool("mediaPref.mic", true);
	cameraEnabled.value = readBool("mediaPref.camera", true);
	selectedCameraId.value = readString("mediaPref.cameraId", "");
	selectedSpeakerId.value = readString("mediaPref.speakerId", "");
	selectedMicId.value = readString("mediaPref.micId", "");
	noiseCancellationEnabled.value = readBool(
		"mediaPref.noiseCancellation",
		false,
	);
	pushToTalkEnabled.value = readBool("mediaPref.pushToTalk", false);
	autoHideToolbar.value = readBool("mediaPref.autoHideToolbar", true);
}
