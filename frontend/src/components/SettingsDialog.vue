<template>
	<Dialog v-model="show" :options="{ title: 'Settings', size: '2xl' }">
		<template #body-content>
			<Tabs as="div" v-model="activeTab" :tabs="tabs">
				<template #tab-panel="{ tab }">
					<DeviceSettingsTab 
						v-if="tab.value === 'devices'"
						@device-changed="$emit('device-changed', $event)"
					/>
					<BackgroundSettingsTab v-if="tab.value === 'background'" />
				</template>
			</Tabs>
		</template>
	</Dialog>
</template>


<script setup>
import { Dialog, Tabs } from "frappe-ui";
import { computed, h, ref } from "vue";
import LucideCamera from "~icons/lucide/camera";
import LucideSettings from "~icons/lucide/settings";
import BackgroundSettingsTab from "./BackgroundSettingsTab.vue";
import DeviceSettingsTab from "./DeviceSettingsTab.vue";

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

// Tabs
const activeTab = ref(0);
const tabs = [
	{ label: "Devices", value: "devices", icon: h(LucideSettings) },
	{ label: "Background", value: "background", icon: h(LucideCamera) },
];
</script>
