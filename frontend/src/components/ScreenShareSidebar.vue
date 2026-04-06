<template>
	<TransitionGroup
		name="tile"
		tag="div"
		class="relative overflow-y-auto grid gap-2 h-full"
		:class="sidebarClass"
		:style="sidebarStyle"
	>
		<!-- Local camera tile -->
		<div
			key="local-camera-sidebar"
			class="relative w-full bg-gray-800 rounded overflow-hidden flex"
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
			<NamePill :name="currentUser?.name" size="sm" position="bottom-left" />

			<div
				v-if="isMicOn && localStream"
				class="absolute top-1 right-1 rounded-full bg-gray-700 p-1"
			>
				<AudioIndicator
					:mediaStream="localStream"
					:isActive="true"
					:maxHeight="12"
					:sensitivity="3.0"
					activeColorClass="bg-gray-100"
				/>
			</div>
			<div v-if="!isMicOn" class="absolute top-1 right-1 bg-gray-700 rounded-full p-1">
				<lucide-mic-off class="w-3 h-3 text-white" />
			</div>
		</div>

		<!-- Remote participants -->
		<ScreenShareSidebarParticipantTile
			v-for="participant in allParticipants"
			:key="'side-' + participant.user_id"
			:participant="participant"
			:class="{ 'hidden-tile': !participant.isVisible }"
			:videoRef="getRemoteVideoRef(participant.user_id)"
			:tileStyle="singleTileStyle"
			:visibleTileCount="visibleTileCount"
		/>

		<!-- Grouping tile -->
		<GroupTile
			v-if="sidebarDisplay.extra > 0"
			key="sidebar-group"
			:count="sidebarDisplay.extra"
			:tooltip="hiddenParticipantsTooltip"
			:participants="sidebarDisplay.hidden"
			@click="handleOpenPeoplePanel"
		/>
	</TransitionGroup>
</template>

<script setup>
import { computed, inject } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import { useScreenShareSidebar } from "../composables/useScreenShareSidebar";
import { useTileAdaptiveStreaming } from "../composables/useTileAdaptiveStreaming";
import AudioIndicator from "./AudioIndicator.vue";
import GroupTile from "./GroupTile.vue";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";
import ScreenShareSidebarParticipantTile from "./ScreenShareSidebarParticipantTile.vue";

const emit = defineEmits(["openPeoplePanel"]);

// Inject meeting state and functions
const meetingState = inject("meetingState");
const setLocalVideoRef = inject("setLocalVideoRef");
const setRemoteVideoRef = inject("setRemoteVideoRef");
const { registerTile } = useTileAdaptiveStreaming();

const videoRefHandlers = new Map();

// cache ref handlers to avoid UI flicker
const getRemoteVideoRef = (participantId) => {
	if (!videoRefHandlers.has(participantId)) {
		videoRefHandlers.set(participantId, (el) => {
			setRemoteVideoRef(participantId, el);
			registerTile(participantId, el);
		});
	}
	return videoRefHandlers.get(participantId);
};

const participants = computed(() => meetingState.participants.value);
const currentUser = computed(() => meetingState.currentUser.value);
const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const stableSpeakerIds = computed(
	() => meetingState.stableSpeakerIds?.value || [],
);

const userInitials = computed(() => {
	const name = currentUser.value?.full_name || currentUser.value?.name || "You";
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
});

const userAvatar = computed(() => currentUser.value?.avatar || "");

const {
	sidebarDisplay,
	allParticipants,
	sidebarClass,
	sidebarStyle,
	singleTileStyle,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useScreenShareSidebar(participants, stableSpeakerIds, meetingState);

const { stream: localStream } = useAudioStream(currentUser.value?.user_id);

const handleOpenPeoplePanel = () => {
	emit("openPeoplePanel");
};
</script>

<style scoped>
.hidden-tile {
	position: absolute;
	opacity: 0;
	pointer-events: none;
	transform: scale(0);
	bottom: 0;
	right: 0;
	z-index: 0;
}
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
