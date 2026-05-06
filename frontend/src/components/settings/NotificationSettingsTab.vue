<template>
	<SettingsLayoutBase
		:description="'Customize notification sounds for meeting events'"
	>
		<template #title>
			Notifications
		</template>
		<template #content>
			<div class="space-y-6">
				<Switch
					class="w-full"
					label="Enable notification sounds"
					description="Play sounds for all meeting events"
					v-model="notificationChimesEnabledLocal"
				/>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { Switch } from "frappe-ui";
import { type Ref, ref, watch } from "vue";
import {
	notificationChimesEnabled,
	setNotificationChimesEnabled,
} from "../../data/notificationPreferences";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const notificationChimesEnabledLocal: Ref<boolean> = ref(
	notificationChimesEnabled.value,
);

watch(notificationChimesEnabledLocal, (newValue) => {
	setNotificationChimesEnabled(newValue);
});
</script>
