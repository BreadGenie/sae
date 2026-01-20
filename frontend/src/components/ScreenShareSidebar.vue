<template>
	<TransitionGroup
		name="tile"
		tag="div"
		class="relative overflow-y-auto p-1 grid gap-2 h-full"
		:class="sidebarClass"
		:style="sidebarStyle"
		@before-leave="lockTileDimensions"
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
			v-for="participant in sidebarDisplay.list"
			:key="'side-' + participant.user_id"
			:participant="participant"
			:videoRef="handleRemoteVideoRef"
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

const handleRemoteVideoRef = (participantId, el) => {
	setRemoteVideoRef(participantId, el);
	registerTile(participantId, el);
};

// needed to avoid layout shifts during tile removal
const lockTileDimensions = (el) => {
	const width = el.offsetWidth;
	const height = el.offsetHeight;
	const top = el.offsetTop;
	const left = el.offsetLeft;

	el.style.position = "absolute";
	el.style.width = `${width}px`;
	el.style.height = `${height}px`;
	el.style.top = `${top}px`;
	el.style.left = `${left}px`;
	el.style.pointerEvents = "none";
};

const participants = computed(() => meetingState.participants.value);
const currentUser = computed(() => meetingState.currentUser.value);
const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const activeSpeakerIds = computed(() => meetingState.activeSpeakerIds.value);

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
	sidebarClass,
	sidebarStyle,
	singleTileStyle,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useScreenShareSidebar(participants, activeSpeakerIds, meetingState);

const { stream: localStream } = useAudioStream(currentUser.value?.user_id);

const handleOpenPeoplePanel = () => {
	emit("openPeoplePanel");
};
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
