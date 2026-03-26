<template>
	<div
		class="w-full overflow-hidden shrink-0 transition-[height,margin] duration-300 ease-in-out"
		:style="{ height: toolbarHeight }"
	>
		<div
			class="flex justify-center px-4 transition-transform duration-300 ease-in-out"
			:class="isVisible ? 'translate-y-0' : 'translate-y-full'"
		>
			<div
				class="flex items-center gap-3 px-6 py-3 bg-black/80 backdrop-blur-md rounded-full border border-white/10 shadow-xl pointer-events-auto transition-all duration-300"
				@mouseenter="onMouseEnter"
				@mouseleave="onMouseLeave"
			>
				<!-- Microphone -->
				<Button
					@click="$emit('toggle-microphone')"
					variant="solid"
					size="2xl"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': !isMicOn,
					}"
					:title="'Toggle Audio (' + ($platform === 'mac' ? '⌘+D' : 'Ctrl+D') + ')'"
				>
					<template #icon>
						<lucide-mic-off v-if="!isMicOn" class="w-5 h-5 text-white" />
						<lucide-mic v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Camera -->
				<Button
					@click="$emit('toggle-camera')"
					variant="solid"
					:theme="isCameraOn ? 'gray' : 'orange'"
					size="2xl"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': !isCameraOn,
					}"
					:title="'Toggle Video (' + ($platform === 'mac' ? '⌘+E' : 'Ctrl+E') + ')'"
				>
					<template #icon>
						<lucide-video-off v-if="!isCameraOn" class="w-5 h-5 text-white" />
						<lucide-video v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Screen Share -->
				<Button
					v-if="canScreenShare()"
					@click="$emit('toggle-screen-share')"
					variant="solid"
					:theme="isScreenSharing ? 'orange' : 'gray'"
					size="2xl"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': isScreenSharing,
					}"
					title="Toggle Screen Share"
				>
					<template #icon>
						<lucide-monitor-up v-if="!isScreenSharing" class="w-5 h-5 text-white" />
						<lucide-monitor-pause v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Reactions -->
				<ReactionPicker
					:is-open="isReactionPickerOpen"
					:is-hand-raised="isHandRaised"
					@select="handleReactionSelect"
					@toggle-raise-hand="$emit('toggle-raise-hand')"
					@update:open="updateReactionPickerOpen"
				>
					<template #trigger>
						<Button
							variant="solid"
							theme="gray"
							size="2xl"
							class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
							:class="{
								'!bg-gray-800 hover:!bg-gray-800': isReactionPickerOpen,
							}"
							title="Reactions & Raise Hand"
						>
							<template #icon>
								<lucide-smile class="w-5 h-5 text-white" />
							</template>
						</Button>
					</template>
				</ReactionPicker>

				<!-- Chat -->
				<div v-if="!isMobile" class="relative">
					<Button
						@click="$emit('toggle-chat')"
						variant="solid"
						size="2xl"
						theme="gray"
						class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
						:class="{
							'!bg-gray-800 hover:!bg-gray-800': isChatOpen,
						}"
						title="Show Chat"
					>
						<template #icon>
							<lucide-message-square-off
								v-if="isChatOpen"
								class="w-5 h-5 text-white"
							/>
							<lucide-message-square v-else class="w-5 h-5 text-white" />
						</template>
					</Button>

					<!-- Unread Badge -->
					<div
						v-if="hasUnread && !isChatOpen"
						class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"
					/>
				</div>

				<!-- People -->
				<div class="relative" v-if="!isMobile">
					<Button
						@click="$emit('toggle-people')"
						variant="solid"
						size="2xl"
						theme="gray"
						class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
						:class="{
							'!bg-gray-800 hover:!bg-gray-800': isPeopleOpen,
						}"
						title="Show Participants"
					>
						<template #icon>
							<lucide-users class="w-5 h-5 text-white" />
						</template>
					</Button>

					<div
						v-if="lobbyUserCount > 0"
						class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"
					/>
				</div>

				<!-- More Options -->
				<div
					class="relative"
					ref="dropdownContainer"
					@click="handleDropdownClick"
				>
					<Dropdown :options="moreOptions" placement="top">
						<template #default>
							<Button
								variant="solid"
								theme="gray"
								size="2xl"
								class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
								title="More options"
							>
								<template #icon>
									<lucide-more-horizontal class="w-5 h-5 text-white" />
								</template>
							</Button>
						</template>
					</Dropdown>
				</div>

				<!-- End Call -->
				<Button
					@click="$emit('end-call')"
					variant="solid"
					theme="red"
					size="2xl"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95 !bg-red-600 hover:!bg-red-500"
					title="End Call"
				>
					<template #icon>
						<lucide-phone-off class="w-5 h-5 text-white" />
					</template>
				</Button>
			</div>
		</div>
	</div>

	<MeetingInfoDialog
		v-model="showMeetingInfoDialog"
		:meetingId="meetingId"
		:meetingTitle="meetingTitle"
	/>

	<SettingsDialog
		v-model="showSettingsDialog"
		:meetingId="meetingId"
		:isPreview="false"
		@device-changed="$emit('device-changed', $event)"
	/>
</template>

<script setup>
import { Button, Dropdown } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
import { autoHideToolbar } from "../data/mediaPreferences";
import { canScreenShare } from "../utils/device";
import MeetingInfoDialog from "./MeetingInfoDialog.vue";
import ReactionPicker from "./ReactionPicker.vue";
import SettingsDialog from "./settings/SettingsDialog.vue";

const props = defineProps({
	isChatOpen: {
		type: Boolean,
		required: true,
	},
	isPeopleOpen: {
		type: Boolean,
		default: false,
	},
	hasUnread: {
		type: Boolean,
		default: false,
	},
	lobbyUserCount: {
		type: Number,
		default: 0,
	},
	isMicOn: {
		type: Boolean,
		required: true,
	},
	isCameraOn: {
		type: Boolean,
		required: true,
	},
	isScreenSharing: {
		type: Boolean,
		required: true,
	},
	isHandRaised: {
		type: Boolean,
		default: false,
	},
	isReactionPickerOpen: {
		type: Boolean,
		default: false,
	},
	meetingId: {
		type: String,
		default: "",
	},
	meetingTitle: {
		type: String,
		default: "",
	},
	currentUser: {
		type: Object,
		default: null,
	},
	cameraPermissionGranted: {
		type: Boolean,
		default: false,
	},
	microphonePermissionGranted: {
		type: Boolean,
		default: false,
	},
});

const { getMeetingDoc } = useMeetingDoc();

if (props.meetingId) {
	getMeetingDoc(props.meetingId);
}

const emit = defineEmits([
	"toggle-chat",
	"toggle-people",
	"toggle-reactions",
	"toggle-microphone",
	"toggle-camera",
	"toggle-screen-share",
	"toggle-raise-hand",
	"end-call",
	"device-changed",
	"update:isReactionPickerOpen",
]);

const { windowWidth } = useResponsiveGrid();
const isMobile = computed(() => windowWidth.value < 768);

const moreOptions = computed(() => [
	{
		icon: "settings",
		label: "Settings",
		onClick: () => {
			showSettingsDialog.value = true;
			resetHideTimer();
		},
	},
	{
		icon: "info",
		label: "Meeting information",
		onClick: () => {
			showMeetingInfoDialog.value = true;
			resetHideTimer();
		},
	},
	...(isMobile.value
		? [
				{
					icon: "users",
					label: "People",
					onClick: () => {
						emit("toggle-people");
						isVisible.value = false;
					},
				},
				{
					icon: "message-square",
					label: "Chat",
					onClick: () => {
						emit("toggle-chat");
						isVisible.value = false;
					},
				},
			]
		: []),
]);

const isVisible = ref(true);
const isHovering = ref(false);
const isDropdownOpen = ref(false);
const dropdownContainer = ref(null);
const showMeetingInfoDialog = ref(false);
const showSettingsDialog = ref(false);
let hideTimeout = null;

const TOOLBAR_VISIBLE_HEIGHT = "5.5rem";
const toolbarHeight = computed(() =>
	isVisible.value ? TOOLBAR_VISIBLE_HEIGHT : "0px",
);

const showControls = () => {
	isVisible.value = true;
	resetHideTimer();
};

const resetHideTimer = (force = false) => {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}

	if (!autoHideToolbar.value) {
		return;
	}

	if (
		!force &&
		(isDropdownOpen.value || isHovering.value || props.isReactionPickerOpen)
	) {
		return;
	}

	hideTimeout = setTimeout(() => {
		isVisible.value = false;
	}, 3000);
};

const handleActivity = () => {
	showControls();
};

const onMouseEnter = () => {
	isHovering.value = true;
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
	isVisible.value = true;
};

const onMouseLeave = () => {
	isHovering.value = false;
	resetHideTimer();
};

const handleShortcut = (event) => {
	if (
		(event.ctrlKey || event.metaKey) &&
		["d", "e"].includes(event.key.toLowerCase())
	) {
		showControls();
	}
};

const handleDropdownClick = (event) => {
	isDropdownOpen.value = !isDropdownOpen.value;

	if (isDropdownOpen.value) {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		isVisible.value = true;
	} else {
		resetHideTimer();
	}
};

const handleDocumentClick = (event) => {
	if (
		dropdownContainer.value &&
		!dropdownContainer.value.contains(event.target)
	) {
		if (isDropdownOpen.value) {
			isDropdownOpen.value = false;
			resetHideTimer();
		}
	}
};

const handleReactionSelect = (emoji) => {
	emit("toggle-reactions", emoji);

	isHovering.value = false;
	updateReactionPickerOpen(false);
	resetHideTimer(true);
};

const updateReactionPickerOpen = (value) => {
	emit("update:isReactionPickerOpen", value);
};

watch(autoHideToolbar, (shouldAutoHide) => {
	if (!shouldAutoHide) {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		isVisible.value = true;
	} else {
		resetHideTimer();
	}
});

onMounted(() => {
	resetHideTimer();

	document.addEventListener("mousemove", handleActivity);
	document.addEventListener("mousedown", handleActivity);
	document.addEventListener("touchstart", handleActivity);
	document.addEventListener("touchmove", handleActivity);
	document.addEventListener("keydown", handleShortcut);
	document.addEventListener("click", handleDocumentClick);
});

onUnmounted(() => {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
	}

	document.removeEventListener("mousemove", handleActivity);
	document.removeEventListener("mousedown", handleActivity);
	document.removeEventListener("touchstart", handleActivity);
	document.removeEventListener("touchmove", handleActivity);
	document.removeEventListener("keydown", handleShortcut);
	document.removeEventListener("click", handleDocumentClick);
});
</script>
