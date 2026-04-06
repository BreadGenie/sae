<template>
	<SettingsLayoutBase :description="'Configure your audio and microphone settings'">
		<template #title>
			Audio
		</template>
		<template #content>
			<div class="space-y-6">
				<Switch
					class="w-full !px-0"
					label="Noise Cancellation"
					description="Reduce background noise from your microphone"
					v-model="noiseCancellationEnabledLocal"
				/>
				<Switch
					class="w-full !px-0"
					label="Push to Talk"
					description="Hold spacebar to unmute your microphone"
					v-model="pushToTalkEnabledLocal"
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
	pushToTalkEnabled,
	setNoiseCancellationEnabled,
	setPushToTalkEnabled,
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

const pushToTalkEnabledLocal: Ref<boolean> = ref(pushToTalkEnabled.value);

watch(pushToTalkEnabledLocal, (newValue) => {
	setPushToTalkEnabled(newValue);
});

watch(pushToTalkEnabled, (newValue) => {
	pushToTalkEnabledLocal.value = newValue;
});
</script>
