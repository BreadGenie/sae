<template>
	<div
		ref="container"
		class="flex-1 min-h-0"
		data-testid="meeting-layout"
		:class="
			mode === 'sidebar'
				? 'relative flex flex-col sm:flex-row overflow-hidden mb-2'
				: 'relative h-full'
		"
	>
		<!-- ── Pinned area (empty placeholder; the pinned tile will be rendered here) ─────────────────── -->
		<div
			v-if="mode === 'sidebar' && pinnedTile"
			ref="pinnedPanel"
			class="relative rounded-lg overflow-hidden flex-1 sm:flex-1 min-h-0 pointer-events-none"
		/>

		<!-- ── Tile strip / full grid ─────────────────────────────────────── -->
		<TransitionGroup
			:name="isFlipAnimating ? '' : 'tile'"
			tag="div"
			class="h-full"
			:class="[
				mode === 'sidebar'
					? `grid gap-2 mt-3 sm:mt-0 sm:ml-3 ${containerClass}`
					: 'relative call-grid',
			]"
			:style="containerStyle"
		>
			<!-- Local camera tile -->
			<ParticipantTile
				:key="`local-${localParticipant.user_id}`"
				:participant="localParticipant"
				:isLocal="true"
				:isVideoEnabled="isCameraOn"
				:isAudioEnabled="isMicOn"
				:isActiveSpeaker="activeSpeakerIds.includes(localParticipant.user_id)"
				:videoRef="setLocalVideoRef"
				:tileCount="visibleTileCount"
				:showReaction="!pinnedTile"
				:style="tileStyle"
			/>

			<ParticipantTile
				v-for="shareTile in allScreenShareTiles"
				:key="shareTile.pinId"
				v-bind="getScreenShareTileBindings(shareTile)"
			/>

			<!-- Remote participants -->
			<template
				v-for="participant in allParticipants"
				:key="`group-${participant.user_id}`"
			>
				<ParticipantTile
					v-bind="getParticipantTileBindings(participant)"
				/>
			</template>

			<!-- Overflow tile -->
			<GroupTile
				v-if="displayParticipants.extra > 0"
				key="layout-group"
				:count="displayParticipants.extra"
				:tooltip="hiddenParticipantsTooltip"
				:participants="displayParticipants.hidden"
				:size="mode === 'sidebar' ? 'small' : 'medium'"
				:style="tileStyle"
				@click="emit('openPeoplePanel')"
			/>
		</TransitionGroup>

		<!-- Floating reactions -->
		<FloatingReactions
			class="!z-[60]"
			:reactions="floatingReactions"
			:container-ref="container"
		/>
	</div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useLayout } from "../composables/useLayout";
import { usePinnedTileAnimation } from "../composables/usePinnedTileAnimation";
import { useScreenShareTiles } from "../composables/useScreenShareTiles";
import { useTileAdaptiveStreaming } from "../composables/useTileAdaptiveStreaming";
import { getInitials } from "../utils/text";
import FloatingReactions from "./FloatingReactions.vue";
import GroupTile from "./GroupTile.vue";
import ParticipantTile from "./ParticipantTile.vue";

const emit = defineEmits(["openPeoplePanel"]);

const meetingState = inject("meetingState");
const setLocalVideoRef = inject("setLocalVideoRef");
const setRemoteVideoRef = inject("setRemoteVideoRef");
const setScreenShareVideoRef = inject("setScreenShareVideoRef");
const getParticipantName = inject("getParticipantName");

const { registerTile } = useTileAdaptiveStreaming();

const container = ref(null);
const pinnedPanel = ref(null);

// Cache ref handlers to avoid UI flicker
const videoRefHandlers = new Map();
const getRemoteVideoRef = (participantId) => {
	if (!videoRefHandlers.has(participantId)) {
		videoRefHandlers.set(participantId, (el) => {
			setRemoteVideoRef(participantId, el);
			registerTile(participantId, el);
		});
	}
	return videoRefHandlers.get(participantId);
};

// ── Reactive state from meetingState ──────────────────────────────────────────

const participants = computed(() => meetingState.participants.value);
const currentUser = computed(() => meetingState.currentUser.value);
const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const activeSpeakerIds = computed(() => meetingState.activeSpeakerIds.value);
const pinnedTile = computed(() => meetingState.pinnedTile.value);
const displayScreenShares = computed(
	() => meetingState.displayScreenShares.value,
);

// ── Pinned area data ──────────────────────────────────────────────────────────

// Unpin when the pinned participant leaves
watch(
	() => {
		if (pinnedTile.value?.type !== "participant") return null;
		return participants.value[pinnedTile.value.id];
	},
	(participant) => {
		if (pinnedTile.value?.type === "participant" && !participant) {
			meetingState.unpinTile();
		}
	},
);

// ── Pin helpers ───────────────────────────────────────────────────────────────

const isPinnedParticipant = (userId) =>
	pinnedTile.value?.type === "participant" && pinnedTile.value.id === userId;

const isPinnedScreenShare = (pinId) =>
	pinnedTile.value?.type === "screenshare" && pinnedTile.value.id === pinId;

const { screenShareTiles: allScreenShareTiles } = useScreenShareTiles({
	displayScreenShares,
	pinnedTile,
	currentUser,
	meetingState,
	getParticipantName,
});

const getScreenShareTileBindings = (shareTile) => {
	const isPinned = isPinnedScreenShare(shareTile.pinId);

	return {
		participant: shareTile.participant,
		isLocal: false,
		isVideoEnabled: true,
		isAudioEnabled: false,
		videoRef: setScreenShareVideoRef,
		tileCount: isPinned ? 1 : visibleTileCount.value,
		class: isPinned ? "pinned-tile" : undefined,
		style: isPinned ? pinnedTileStyle.value : tileStyle.value,
		pinType: "screenshare",
		pinId: shareTile.pinId,
		labelSize: isPinned ? "sm" : undefined,
		labelPosition: isPinned ? "top-left" : undefined,
		videoObjectFitClass: isPinned ? "object-contain" : undefined,
		videoBackgroundClass: isPinned ? "bg-gray-900" : undefined,
		tileBackgroundClass: isPinned ? "bg-black" : undefined,
		showAvatar: !isPinned,
		showReaction: !isPinned,
		showRaisedHand: !isPinned,
		showAudioState: !isPinned,
		showNetworkState: !isPinned,
	};
};

const getParticipantTileBindings = (participant) => {
	const isPinned = isPinnedParticipant(participant.user_id);

	return {
		class: {
			"hidden-tile": !participant.isVisible && !isPinned,
			"pinned-tile": isPinned,
		},
		participant,
		isLocal: false,
		isVideoEnabled: participant.video_enabled,
		isAudioEnabled: participant.audio_enabled,
		isActiveSpeaker: activeSpeakerIds.value.includes(participant.user_id),
		videoRef: getRemoteVideoRef(participant.user_id),
		tileCount: isPinned ? 1 : visibleTileCount.value,
		showReaction: !pinnedTile.value,
		style: isPinned
			? pinnedTileStyle.value
			: participant.isVisible
				? tileStyle.value
				: undefined,
	};
};

// ── Local participant object ───────────────────────────────────────────────────

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

	return { user_id, user_name, avatar, initials: getInitials(user_name) };
});

// Number of extra strip tiles (pinned screenshares overlay the main panel instead)
const extraTileCount = computed(() => {
	if (pinnedTile.value?.type !== "screenshare")
		return allScreenShareTiles.value.length;
	return Math.max(0, allScreenShareTiles.value.length - 1);
});

// ── Layout composable ─────────────────────────────────────────────────────────

const {
	mode,
	containerStyle,
	containerClass,
	tileStyle,
	displayParticipants,
	allParticipants,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useLayout(participants, pinnedTile, meetingState, extraTileCount);

const { isFlipAnimating, pinnedTileStyle } = usePinnedTileAnimation({
	container,
	pinnedPanel,
	pinnedTile,
	visibleTileCount,
});

// ── Floating reactions ────────────────────────────────────────────────────────
// Grid mode: only reactions from hidden participants (visible tiles show their own)
// Sidebar mode: reactions from all participants (sidebar tiles use ParticipantTile
//   which shows reactions, main screen area doesn't)

const floatingReactions = computed(() => {
	const reactions = meetingState.reactions?.value || {};
	const currentUserId = currentUser.value?.user_id;

	let sourceIds;
	if (mode.value === "grid") {
		sourceIds = new Set(displayParticipants.value.hidden.map((p) => p.user_id));
	} else {
		// All participant IDs for sidebar mode
		sourceIds = new Set([
			...Object.keys(participants.value),
			...(currentUserId ? [currentUserId] : []),
		]);
	}

	const result = [];
	for (const [userId, reaction] of Object.entries(reactions)) {
		if (!sourceIds.has(userId) || !reaction) continue;
		const participant =
			userId === currentUserId ? currentUser.value : participants.value[userId];
		const userName =
			participant?.user_name ||
			participant?.name ||
			participant?.user_id ||
			"Unknown";
		result.push({
			userId,
			userName,
			emoji: reaction.emoji,
			timestamp: reaction.expiresAt - 5000,
			expiresAt: reaction.expiresAt,
			uniqueId: `${userId}-${reaction.emoji}-${reaction.expiresAt}`,
		});
	}

	return result
		.sort((a, b) => {
			const diff = b.timestamp - a.timestamp;
			return diff !== 0 ? diff : a.userId.localeCompare(b.userId);
		})
		.slice(0, 6);
});
</script>

<style scoped>
/* Pinned tile overlays the pinned panel placeholder */
.pinned-tile {
	border-radius: 0.5rem;
	overflow: hidden;
	pointer-events: auto;
	will-change: transform, top, left, width, height;
	backface-visibility: hidden;
	transform: translateZ(0);
}

/* Hidden tiles stay mounted to preserve grid animation continuity */
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
	transform: scale(0.85);
}

.tile-enter-active,
.tile-leave-active {
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tile-move {
	transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}

.tile-leave-active {
	position: absolute;
	z-index: 0;
}
</style>
