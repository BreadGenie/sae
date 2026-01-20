<template>
	<SettingsLayoutBase
		:description="'Configure audio processing options for your microphone'"
	>
		<template #title>
			Audio
		</template>
		<template #content>
			<div class="space-y-6">
				<Switch
					class="w-full"
					label="Noise Cancellation"
					description="Reduce background noise from your microphone"
					v-model="noiseCancellationEnabledLocal"
				/>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { Switch } from "frappe-ui";
import { type Ref, ref, watch } from "vue";
import {
	noiseCancellationEnabled,
	setNoiseCancellationEnabled,
} from "../../data/mediaPreferences";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const noiseCancellationEnabledLocal: Ref<boolean> = ref(
	noiseCancellationEnabled.value,
);

watch(noiseCancellationEnabledLocal, (newValue) => {
	setNoiseCancellationEnabled(newValue);
});

watch(noiseCancellationEnabled, (newValue) => {
	noiseCancellationEnabledLocal.value = newValue;
});
</script>
