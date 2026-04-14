<template>
	<div
		ref="container"
		class="flex-1 min-h-0"
		data-testid="meeting-layout"
		:class="
			mode === 'sidebar'
				? 'flex flex-col sm:flex-row overflow-hidden mb-2'
				: 'relative h-full'
		"
	>
		<!-- ── Pinned area ────────────────────────────────────────────────── -->
		<div
			v-if="mode === 'sidebar' && pinnedTile"
			ref="pinnedPanel"
			class="group/pinned relative bg-black rounded-lg overflow-hidden flex items-center justify-center flex-1 sm:flex-1 min-h-0"
		>
			<ParticipantTile
				v-if="pinnedTile.type === 'screenshare' && pinnedScreenShareTileParticipant"
				:participant="pinnedScreenShareTileParticipant"
				:isLocal="false"
				:isVideoEnabled="true"
				:isAudioEnabled="false"
				:videoRef="setScreenShareVideoRef"
				:tileCount="1"
				pinType="screenshare"
				:pinId="pinnedTile.id || null"
				labelSize="sm"
				labelPosition="top-left"
				videoObjectFitClass="object-contain"
				videoBackgroundClass="bg-gray-900"
				tileBackgroundClass="bg-black"
				:showAvatar="false"
				:showReaction="false"
				:showRaisedHand="false"
				:showAudioState="false"
				:showNetworkState="false"
				class="absolute inset-0 w-full h-full pin-anim-target"
			/>

			<!-- Pinned participant tile (fills the area) -->
			<ParticipantTile
				v-else-if="pinnedParticipant"
				:participant="pinnedParticipant"
				:isLocal="false"
				:isVideoEnabled="pinnedParticipant.video_enabled"
				:isAudioEnabled="pinnedParticipant.audio_enabled"
				:isActiveSpeaker="activeSpeakerIds.includes(pinnedParticipant.user_id)"
				:videoRef="getRemoteVideoRef(pinnedParticipant.user_id)"
				:tileCount="1"
				class="absolute inset-0 w-full h-full pin-anim-target"
			/>

		</div>

		<!-- ── Tile strip / full grid ─────────────────────────────────────── -->
		<TransitionGroup
			name="tile"
			tag="div"
			class="relative h-full"
			:class="[
				mode === 'sidebar'
					? 'overflow-y-auto grid gap-2 mt-3 sm:mt-0 sm:ml-3 ' + containerClass
					: 'call-grid',
			]"
			:style="containerStyle"
		>
			<!-- Local camera tile -->
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

			<ParticipantTile
				v-for="shareTile in visibleScreenShareTiles"
				:key="shareTile.pinId"
				:data-tile-id="`screenshare-${shareTile.pinId}`"
				:participant="shareTile.participant"
				:isLocal="false"
				:isVideoEnabled="true"
				:isAudioEnabled="false"
				:videoRef="setScreenShareVideoRef"
				:tileCount="visibleTileCount"
				:style="tileStyle"
				pinType="screenshare"
				:pinId="shareTile.pinId"
				labelSize="sm"
				videoObjectFitClass="object-contain"
				videoBackgroundClass="bg-gray-900"
				tileBackgroundClass="bg-black"
				:showAvatar="false"
				:showReaction="false"
				:showRaisedHand="false"
				:showAudioState="false"
				:showNetworkState="false"
			/>

			<!-- Remote participants -->
			<template
				v-for="participant in allParticipants"
				:key="'group-' + participant.user_id"
			>
				<ParticipantTile
					:data-tile-id="`participant-${participant.user_id}`"
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
import { computed, inject, nextTick, ref, watch } from "vue";
import { useLayout } from "../composables/useLayout";
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

// ── Auto-pin screen shares ────────────────────────────────────────────────────
// When a NEW screen share starts, pin it. When it ends, clean up.

watch(
	displayScreenShares,
	(shares, oldShares) => {
		const newId = shares[0]?.consumerId;
		const oldId = oldShares?.[0]?.consumerId;

		if (shares.length > 0 && newId !== oldId) {
			// New screen share started — pin it
			meetingState.pinTile("screenshare", newId);
		} else if (shares.length > 0 && !pinnedTile.value) {
			// No pin — auto-pin (initial load)
			meetingState.pinTile("screenshare", newId);
		} else if (
			shares.length === 0 &&
			pinnedTile.value?.type === "screenshare"
		) {
			meetingState.unpinTile();
		}
	},
	{ immediate: true },
);

// ── Pinned area data ──────────────────────────────────────────────────────────

const pinnedParticipant = computed(() => {
	if (pinnedTile.value?.type !== "participant") return null;
	return participants.value[pinnedTile.value.id] || null;
});

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

const screenShareTileParticipants = computed(() => {
	return displayScreenShares.value.map((share) => {
		const participantName = getParticipantName(share.participantId);
		const isLocalSharer = currentUser.value?.user_id === share.participantId;
		const localName = currentUser.value?.full_name || currentUser.value?.name;
		const displayName = `${
			isLocalSharer ? localName : participantName
		}'s screen`;

		return {
			pinId: share.consumerId,
			participant: {
				user_id: share.participantId,
				user_name: displayName,
				avatar: "",
				initials: getInitials(displayName),
			},
		};
	});
});

const pinnedScreenShareTileParticipant = computed(() => {
	if (pinnedTile.value?.type !== "screenshare") return null;
	return (
		screenShareTileParticipants.value.find(
			(share) => share.pinId === pinnedTile.value.id,
		)?.participant || null
	);
});

const visibleScreenShareTiles = computed(() => {
	if (pinnedTile.value?.type === "screenshare") {
		return screenShareTileParticipants.value.filter(
			(share) => share.pinId !== pinnedTile.value.id,
		);
	}
	return screenShareTileParticipants.value;
});

const getPinnedSourceSelector = (tile) => {
	if (!tile?.id || !tile?.type) return null;
	return `[data-tile-id="${tile.type}-${tile.id}"]`;
};

// Animate pinned tile from its position in the grid to the pinned area
watch(
	pinnedTile,
	async (nextPinned, prevPinned) => {
		if (mode.value !== "sidebar" || !nextPinned?.id) return;
		const pinChanged =
			!prevPinned ||
			prevPinned.id !== nextPinned.id ||
			prevPinned.type !== nextPinned.type;
		if (!pinChanged) return;

		const sourceSelector = getPinnedSourceSelector(nextPinned);
		const sourceEl = sourceSelector
			? container.value?.querySelector(sourceSelector)
			: null;
		const sourceRect = sourceEl?.getBoundingClientRect();
		if (!sourceRect) return;

		await nextTick();

		const targetEl = pinnedPanel.value?.querySelector(".pin-anim-target");
		const targetRect = targetEl?.getBoundingClientRect();
		if (!targetRect || !targetEl) return;

		const dx = sourceRect.left - targetRect.left;
		const dy = sourceRect.top - targetRect.top;
		const sx = sourceRect.width / targetRect.width;
		const sy = sourceRect.height / targetRect.height;

		targetEl.animate(
			[
				{
					transformOrigin: "top left",
					transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
					opacity: 0.9,
				},
				{
					transformOrigin: "top left",
					transform: "translate(0px, 0px) scale(1, 1)",
					opacity: 1,
				},
			],
			{
				duration: 360,
				easing: "cubic-bezier(0.22, 1, 0.36, 1)",
				fill: "both",
			},
		);
	},
	{ flush: "pre" },
);

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

// Number of extra (non-participant) tiles in the grid, e.g. an unpinned screen share
const extraTileCount = computed(() => visibleScreenShareTiles.value.length);

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
