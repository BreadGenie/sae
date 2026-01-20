<template>
	<Dialog
		v-model="show"
		:options="{ size: '5xl' }"
	>
		<template #body>
			<div class="flex z-50" :style="{ height: 'calc(100vh - 8rem)' }">
				<div
					class="flex w-52 shrink-0 flex-col bg-gray-50 p-2 overflow-y-auto hide-scrollbar"
				>
					<h1 class="px-2 pt-2 text-lg font-semibold mb-2">
						Settings
					</h1>
					<div v-for="tab in tabs">
						<div
							v-if="!tab.hideLabel"
							class="mb-2 mt-3 flex gap-1.5 px-1 text-base font-medium text-ink-gray-5"
						>
							<span>{{ tab.label }}</span>
						</div>
						<nav class="space-y-1">
							<button
								v-for="item in tab.items"
								:key="item.label"
								class="flex h-7 w-full items-center gap-2 rounded px-2 py-1"
								:class="[
									activeTab?.label == item.label
										? 'bg-white shadow-sm'
										: 'hover:bg-gray-100',
								]"
								@click="() => onTabChange(item)"
							>
								<component :is="item.icon" class="h-4 w-4 text-gray-700" />
								<span class="text-base text-gray-800">
									{{ item.label }}
								</span>
							</button>
						</nav>
					</div>
				</div>
				<div class="flex flex-1 flex-col bg-surface-modal max-w-[816px]">
					<component
						:is="activeTab.component"
						v-if="activeTab"
						class="h-full flex flex-col w-full"
						@device-changed="$emit('device-changed', $event)"
						:is-visible="show"
						:meeting-id="meetingId"
					/>
				</div>
			</div>
		</template>
	</Dialog>
</template>


<script setup>
import { Dialog } from "frappe-ui";
import { computed, h, markRaw, ref } from "vue";
import LucideAudioLines from "~icons/lucide/audio-lines";
import LucideBell from "~icons/lucide/bell";
import LucideCamera from "~icons/lucide/camera";
import LucideMonitorSmartphone from "~icons/lucide/monitor-smartphone";
import LucideSettings from "~icons/lucide/settings";
import { useMeetingDoc } from "../../composables/useMeetingDoc";
import AudioSettingsTab from "./AudioSettingsTab.vue";
import BackgroundSettingsTab from "./BackgroundSettingsTab.vue";
import DeviceSettingsTab from "./DeviceSettingsTab.vue";
import HostSettingsTab from "./HostSettingsTab.vue";
import NotificationSettingsTab from "./NotificationSettingsTab.vue";

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	meetingId: {
		type: String,
		default: "",
	},
	isPreview: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(["device-changed", "update:modelValue"]);

const { isCurrentUserHost } = useMeetingDoc();

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

// Settings tabs structure
const tabs = computed(() => {
	const allTabs = [];

	if (isCurrentUserHost.value && !props.isPreview) {
		allTabs.push({
			label: "Host Settings",
			items: [
				{
					label: "General",
					icon: h(LucideSettings),
					component: markRaw(HostSettingsTab),
				},
			],
		});
	}

	allTabs.push({
		label: "General",
		items: [
			{
				label: "Devices",
				icon: h(LucideMonitorSmartphone),
				component: markRaw(DeviceSettingsTab),
			},
			{
				label: "Audio",
				icon: h(LucideAudioLines),
				component: markRaw(AudioSettingsTab),
			},
			{
				label: "Notifications",
				icon: h(LucideBell),
				component: markRaw(NotificationSettingsTab),
			},
			{
				label: "Background",
				icon: h(LucideCamera),
				component: markRaw(BackgroundSettingsTab),
			},
		],
	});

	return allTabs;
});

const activeTab = ref(tabs.value[0].items[0]);

function onTabChange(tab) {
	activeTab.value = tab;
}
</script>
