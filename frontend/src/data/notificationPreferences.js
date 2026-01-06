import { ref } from "vue";

function readBool(key, def = true) {
	const v = localStorage.getItem(key);
	if (v === null) return def;
	return v === "1";
}

export const notificationChimesEnabled = ref(
	readBool("notificationPref.chimesEnabled", true),
);

export function setNotificationChimesEnabled(val) {
	notificationChimesEnabled.value = !!val;
	localStorage.setItem(
		"notificationPref.chimesEnabled",
		notificationChimesEnabled.value ? "1" : "0",
	);
}
