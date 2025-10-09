<template>
	<TransitionGroup
		name="tile"
		tag="div"
		class="overflow-y-auto p-1 grid gap-2 h-full"
		:class="sidebarClass"
		:style="sidebarStyle"
	>
		<!-- Local camera tile -->
		<div
			key="local-camera-sidebar"
			class="relative w-full bg-gray-800 rounded overflow-hidden flex"
			:class="{ 'ring-2 ring-blue-400': activeSpeakerIds.includes(currentUser?.user_id) }"
			:style="singleTileStyle"
		>
			<video
				:ref="setLocalVideoRef"
				class="w-full h-full object-cover transform scale-x-[-1] flex-1"
				autoplay
				muted
				playsinline
			/>
			<div
				v-if="!isCameraOn"
				class="absolute inset-0 bg-gray-700 flex items-center justify-center"
			>
				<MeetingAvatar
					:label="userInitials"
					:image="userAvatar"
					:tiles="visibleTileCount"
				/>
			</div>
			<NamePill name="You" size="sm" position="bottom-left" />
		</div>

		<!-- Remote participants -->
		<div
			v-for="participant in sidebarDisplay.list"
			:key="'side-' + participant.user_id"
			class="relative w-full bg-gray-800 rounded overflow-hidden flex"
			:class="{ 'ring-2 ring-blue-400': activeSpeakerIds.includes(participant.user_id) }"
			:style="singleTileStyle"
		>
			<video
				:ref="(el) => setRemoteVideoRef(participant.user_id, el)"
				:participant-id="participant.user_id"
				class="w-full h-full object-cover flex-1 remote-video"
				autoplay
				muted
				playsinline
			></video>
			<div
				v-if="!participant.video_enabled"
				class="absolute inset-0 flex items-center justify-center bg-gray-700"
			>
				<MeetingAvatar
					:image="participant.avatar"
					:label="participant.initials"
					:tiles="visibleTileCount"
				/>
			</div>
			<NamePill :name="participant.user_name" size="sm" position="bottom-left" />
			<div
				v-if="!participant.audio_enabled"
				class="absolute top-1 right-1 bg-gray-700 rounded-full p-1"
			>
				<lucide-mic-off class="w-3 h-3 text-white" />
			</div>
		</div>

		<!-- Grouping tile -->
		<div
			v-if="sidebarDisplay.extra > 0"
			key="sidebar-group"
			:title="hiddenParticipantsTooltip"
				class="relative w-full bg-gray-800/70 rounded overflow-hidden flex items-center justify-center cursor-pointer"
		>
			<div class="text-xs text-white text-center px-2 leading-snug">
				and {{ sidebarDisplay.extra }} others
			</div>
		</div>
	</TransitionGroup>
</template>

<script setup>
import { Tooltip } from "frappe-ui";
import { computed } from "vue";
import { useScreenShareSidebar } from "../composables/useScreenShareSidebar.js";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";

const props = defineProps({
	participants: {
		type: Object,
		required: true,
	},
	currentUser: {
		type: Object,
		required: true,
	},
	isCameraOn: {
		type: Boolean,
		default: false,
	},
	isMicOn: {
		type: Boolean,
		default: false,
	},
	setLocalVideoRef: {
		type: Function,
		required: true,
	},
	setRemoteVideoRef: {
		type: Function,
		required: true,
	},
	activeSpeakerIds: {
		type: Array,
		default: () => [],
	},
});

const userInitials = computed(() => {
	const name = props.currentUser?.full_name || props.currentUser?.name || "You";
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
});

const userAvatar = computed(() => props.currentUser?.avatar || "");
const activeSpeakerIds = computed(() => props.activeSpeakerIds);

const {
	sidebarDisplay,
	sidebarClass,
	sidebarStyle,
	singleTileStyle,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useScreenShareSidebar(props.participants, activeSpeakerIds);
</script>

<style scoped>
/* Transition styles */
.tile-enter-from,
.tile-leave-to {
	opacity: 0;
	transform: scale(0.85) translateY(8px);
}

.tile-enter-active,
.tile-leave-active {
	transition:
		opacity 200ms ease,
		transform 200ms ease;
}

.tile-move {
	transition: transform 200ms ease;
}

.tile-leave-active {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.remote-video {
	background-color: #000;
	will-change: transform;
	transform: translateZ(0);
}

@-moz-document url-prefix() {
	.remote-video {
		background-color: #111;
		opacity: 0.99;
	}
}
</style>
