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

			<div v-if="isMicOn && localStream" class="absolute top-1 right-1 rounded-full bg-gray-700 p-1">
				<AudioIndicator
					:mediaStream="localStream"
					:isActive="true"
					:maxHeight="12"
					:sensitivity="3.0"
					activeColorClass="bg-gray-100"
				/>
			</div>
			<div
				v-if="!isMicOn"
				class="absolute top-1 right-1 bg-gray-700 rounded-full p-1"
			>
				<lucide-mic-off class="w-3 h-3 text-white" />
			</div>
		</div>

		<!-- Remote participants -->
		<div
			v-for="participant in sidebarDisplay.list"
			:key="'side-' + participant.user_id"
			class="relative w-full bg-gray-800 rounded overflow-hidden flex"
			:style="singleTileStyle"
		>
			<video
				:ref="(el) => handleRemoteVideoRef(participant.user_id, el)"
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

			<div v-if="participant.audio_enabled && participantStreams[participant.user_id]" class="absolute top-1 right-1">
				<AudioIndicator
					:mediaStream="participantStreams[participant.user_id]"
					:isActive="true"
					:maxHeight="12"
					:sensitivity="3.0"
					activeColorClass="bg-gray-100"
				/>
			</div>
			<div
				v-if="!participant.audio_enabled"
				class="absolute top-1 right-1 bg-gray-700 rounded-full p-1"
			>
				<lucide-mic-off class="w-3 h-3 text-white" />
			</div>

			<div
				v-if="isHandRaised(participant.user_id)"
				class="absolute bottom-1 right-2 px-2 py-1 rounded-full !bg-[#e54e17] text-white pointer-events-none"
				:aria-label="`${participant.user_name || participant.user_id} has raised their hand`"
			>
				<lucide-hand class="w-3.5 h-3.5" />
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
import { computed, inject } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import { useScreenShareSidebar } from "../composables/useScreenShareSidebar.js";
import { useTileAdaptiveStreaming } from "../composables/useTileAdaptiveStreaming";
import { getSFUMeetingManager } from "../utils/sfu-meeting-manager.js";
import AudioIndicator from "./AudioIndicator.vue";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";

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

const participantStreams = computed(() => {
	const streams = {};
	for (const participant of Object.values(participants.value)) {
		try {
			const sfuManager = getSFUMeetingManager();
			if (sfuManager?.consumerManager) {
				const audioConsumer = sfuManager.consumerManager.getAudioConsumer(
					participant.user_id,
				);
				if (audioConsumer?.track) {
					streams[participant.user_id] = new MediaStream([audioConsumer.track]);
				}
			}
		} catch (error) {
			console.error(
				"Error getting stream for participant:",
				participant.user_id,
				error,
			);
		}
	}
	return streams;
});

const isHandRaised = (participantId) => {
	if (!meetingState?.raisedHands?.value) return false;
	return !!meetingState.raisedHands.value[participantId];
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
