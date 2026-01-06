import { type Ref, ref } from "vue";

function readBool(key: string, def = true): boolean {
	const v = localStorage.getItem(key);
	if (v === null) return def;
	return v === "1";
}

export const notificationChimesEnabled: Ref<boolean> = ref(
	readBool("notificationPref.chimesEnabled", true),
);

export function setNotificationChimesEnabled(val: boolean): void {
	notificationChimesEnabled.value = !!val;
	localStorage.setItem(
		"notificationPref.chimesEnabled",
		notificationChimesEnabled.value ? "1" : "0",
	);
}
