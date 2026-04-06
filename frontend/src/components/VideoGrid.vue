<template>
	<div ref="gridContainer" class="relative flex-1 min-h-0 h-full">
		<TransitionGroup
			name="tile"
			tag="div"
			class="h-full call-grid"
			:style="gridStyle"
		>
			<!-- Local user video -->
			<ParticipantTile
				:key="'local-' + localParticipant.user_id"
				:participant="localParticipant"
				:isLocal="true"
				:isVideoEnabled="isCameraOn"
				:isAudioEnabled="isMicOn"
				:isActiveSpeaker="activeSpeakerIds.includes(localParticipant.user_id)"
				:videoRef="setLocalVideoRef"
				:tileCount="visibleTileCount"
				:style="tileStyle"
			/>

			<!-- Remote participants -->
			<template
				v-for="participant in allParticipants"
				:key="'group-' + participant.user_id"
			>
				<ParticipantTile
					:class="{ 'hidden-tile': !participant.isVisible }"
					:participant="participant"
					:isLocal="false"
					:isVideoEnabled="participant.video_enabled"
					:isAudioEnabled="participant.audio_enabled"
					:isActiveSpeaker="activeSpeakerIds.includes(participant.user_id)"
					:videoRef="getRemoteVideoRef(participant.user_id)"
					:tileCount="visibleTileCount"
					:style="participant.isVisible ? tileStyle : undefined"
				/>
				<!-- needed for dynamic row breaks -->
				<div
					v-if="participant.isVisible && participant.needsBreakAfter"
					:key="'break-' + participant.user_id"
					class="flex-break"
				/>
			</template>

			<!-- Grouping tile for overflow participants -->
			<GroupTile
				v-if="displayParticipants.extra > 0"
				key="grid-group"
				:count="displayParticipants.extra"
				:tooltip="hiddenParticipantsTooltip"
				:participants="displayParticipants.hidden"
				size="medium"
				:style="tileStyle"
				@click="handleGroupTileClick"
			/>
		</TransitionGroup>

		<!-- Floating reactions for hidden participants -->
		<FloatingReactions
			:reactions="hiddenParticipantReactions"
			:container-ref="gridContainer"
		/>
	</div>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useTileAdaptiveStreaming } from "../composables/useTileAdaptiveStreaming";
import { useVideoGridLayout } from "../composables/useVideoGridLayout";
import { getInitials } from "../utils/text";
import FloatingReactions from "./FloatingReactions.vue";
import GroupTile from "./GroupTile.vue";
import ParticipantTile from "./ParticipantTile.vue";

const emit = defineEmits(["openPeoplePanel"]);

const meetingState = inject("meetingState");
const setLocalVideoRef = inject("setLocalVideoRef");
const setRemoteVideoRef = inject("setRemoteVideoRef");
const { registerTile } = useTileAdaptiveStreaming();

const handleGroupTileClick = () => {
	emit("openPeoplePanel");
};

const handleRemoteVideoRef = (participantId, el) => {
	setRemoteVideoRef(participantId, el);
	registerTile(participantId, el);
};

const videoRefHandlers = new Map();

// cache ref handlers to avoid UI flicker
const getRemoteVideoRef = (participantId) => {
	if (!videoRefHandlers.has(participantId)) {
		videoRefHandlers.set(participantId, (el) => {
			handleRemoteVideoRef(participantId, el);
		});
	}
	return videoRefHandlers.get(participantId);
};

const gridContainer = ref(null);

const participants = computed(() => meetingState.participants.value);
const currentUser = computed(() => meetingState.currentUser.value);
const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const activeSpeakerIds = computed(() => meetingState.activeSpeakerIds.value);

const localParticipant = computed(() => {
	const userIdRaw = currentUser.value?.user_id;
	const fullNameRaw = currentUser.value?.full_name;
	const nameRaw = currentUser.value?.name;
	const avatarRaw = currentUser.value?.avatar;

	const user_id =
		typeof userIdRaw === "string"
			? userIdRaw
			: userIdRaw == null
				? "local"
				: String(userIdRaw);
	const displayNameRaw = fullNameRaw ?? nameRaw ?? "You";
	const user_name =
		typeof displayNameRaw === "string"
			? displayNameRaw
			: String(displayNameRaw);
	const avatar =
		typeof avatarRaw === "string"
			? avatarRaw
			: avatarRaw == null
				? ""
				: String(avatarRaw);

	return {
		user_id,
		user_name,
		avatar,
		initials: getInitials(user_name),
	};
});

const {
	displayParticipants,
	allParticipants,
	gridStyle,
	tileStyle,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useVideoGridLayout(participants, meetingState);

const hiddenParticipantReactions = computed(() => {
	const reactions = meetingState.reactions?.value || {};
	const hiddenUserIds = new Set(
		displayParticipants.value.hidden.map((p) => p.user_id),
	);

	const hiddenReactions = [];

	for (const [userId, reaction] of Object.entries(reactions)) {
		if (hiddenUserIds.has(userId) && reaction) {
			const participant = displayParticipants.value.hidden.find(
				(p) => p.user_id === userId,
			);
			const userName =
				participant?.user_name || participant?.user_id || "Unknown";

			hiddenReactions.push({
				userId,
				userName,
				emoji: reaction.emoji,
				timestamp: reaction.expiresAt - 5000,
				expiresAt: reaction.expiresAt,
				uniqueId: `${userId}-${reaction.emoji}-${reaction.expiresAt}`,
			});
		}
	}

	// Sort (most recent first) and limit to 6 reactions
	const sorted = [...hiddenReactions].sort((a, b) => {
		const timeDiff = b.timestamp - a.timestamp;
		if (timeDiff !== 0) return timeDiff;
		return a.userId.localeCompare(b.userId);
	});

	return sorted.slice(0, 6);
});
</script>

<style scoped>
/* Hidden tiles are kept mounted to not affect grid layout animations. */
.hidden-tile {
	position: absolute;
	opacity: 0;
	pointer-events: none;
	transform: scale(0);
	bottom: 0;
	right: 0;
	z-index: 0;
}

/* Invisible element that forces flexbox to start a new line. */
.flex-break {
	flex-basis: 100%;
	height: 0;
	overflow: hidden;
	padding: 0;
	margin: 0;
	border: 0;
}

/* Animation styles */
.tile-enter-from,
.tile-leave-to {
	opacity: 0;
	transform: scale(0.85);
}

.tile-enter-active,
.tile-leave-active {
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tile-move {
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tile-leave-active {
	position: absolute;
	z-index: 0;
}
</style>
