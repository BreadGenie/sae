<template>
	<SettingsLayoutBase
		:description="'Customize notification sounds for meeting events'"
	>
		<template #title>
			Notifications
		</template>
		<template #content>
			<div class="space-y-6">
				<div class="flex items-center justify-between">
					<div class="flex flex-col gap-1">
						<span class="text-base font-medium text-ink-gray-8">
							Enable notification sounds
						</span>
						<span class="text-p-sm text-ink-gray-6">
							Play sounds for all meeting events
						</span>
					</div>
					<Switch
						v-model="notificationChimesEnabledLocal"
					/>
				</div>
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
} from "../../data/notificationPreferences.js";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const notificationChimesEnabledLocal: Ref<boolean> = ref(
	notificationChimesEnabled.value,
);

watch(notificationChimesEnabledLocal, (newValue) => {
	setNotificationChimesEnabled(newValue);
});
</script>
