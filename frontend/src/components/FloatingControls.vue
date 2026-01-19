<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-y-4"
		enter-to-class="opacity-100 transform translate-y-0"
		:leave-active-class="
			instantHide
				? 'duration-0'
				: 'transition-all duration-300 ease-in'
		"
		leave-from-class="opacity-100 transform translate-y-0"
		:leave-to-class="
			instantHide ? 'opacity-0' : 'opacity-0 transform translate-y-4'
		"
	>
		<div
			v-show="isVisible"
			:class="[
				'z-5 pointer-events-none w-auto max-w-3xl px-4 md:px-0 bottom-4 left-1/2 transform -translate-x-1/2',
				isPreview ? 'absolute' : 'fixed',
			]"
		>
			<div
				class="flex items-center gap-3 px-6 py-3 bg-black/80 backdrop-blur-md rounded-full border border-white/10 shadow-xl pointer-events-auto transition-all duration-300 mx-auto"
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
					v-if="!isPreview && canScreenShare()"
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
							v-if="!isPreview"
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

				<!-- Raise Hand -->


				<!-- Chat -->
				<div v-if="!isPreview && !isMobile" class="relative">
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
				<div class="relative" v-if="!isPreview && !isMobile">
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

				<!-- Settings -->
				<Button
					v-if="isPreview && (cameraPermissionGranted || microphonePermissionGranted)"
					@click="showSettingsDialog = true"
					variant="solid"
					theme="gray"
					size="2xl"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					title="Settings"
				>
					<template #icon>
						<lucide-settings class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- More Options -->
				<div
					v-if="!isPreview"
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
					v-if="!isPreview"
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
	</Transition>

	<MeetingInfoDialog
		v-model="showMeetingInfoDialog"
		:meetingId="meetingId"
		:meetingTitle="meetingTitle"
	/>


	<SettingsDialog
		v-model="showSettingsDialog"
		:meetingId="meetingId"
		:isPreview="isPreview"
		@device-changed="$emit('device-changed', $event)"
	/>
</template>

<script setup>
import { Button, Dropdown } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, toRefs } from "vue";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
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
	isPreview: {
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

const { isPreview } = toRefs(props);

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
		condition: () =>
			props.cameraPermissionGranted ||
			props.microphonePermissionGranted ||
			!isPreview.value,
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
						instantHide.value = true;
						isVisible.value = false;
						setTimeout(() => {
							instantHide.value = false;
						}, 300);
					},
				},
				{
					icon: "message-square",
					label: "Chat",
					onClick: () => {
						emit("toggle-chat");
						instantHide.value = true;
						isVisible.value = false;
						setTimeout(() => {
							instantHide.value = false;
						}, 300);
					},
				},
			]
		: []),
]);

const isVisible = ref(true);
const instantHide = ref(false);
const isHovering = ref(false);
const isDropdownOpen = ref(false);
const dropdownContainer = ref(null);
const showMeetingInfoDialog = ref(false);
const showSettingsDialog = ref(false);
let hideTimeout = null;

const showControls = () => {
	isVisible.value = true;
	resetHideTimer();
};

const resetHideTimer = (force = false) => {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
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
	// for not hiding controls when clicked on dropdown
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
