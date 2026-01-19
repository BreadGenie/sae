<template>
	<div
		ref="screenShareContainer"
		class="flex-1 flex flex-col sm:flex-row min-h-0 overflow-hidden mb-2"
	>
		<!-- Screen share video - full width on mobile, flex-1 on larger screens -->
		<div
			class="relative bg-black rounded-lg overflow-hidden flex items-center justify-center flex-1 sm:flex-1"
		>
			<template v-for="(share, idx) in displayScreenShares" :key="share.consumerId">
				<!-- Render only the first (focused) screen share -->
				<video
					v-if="idx === 0"
					:ref="setScreenShareVideoRef"
					:data-participant-id="share.participantId"
					class="w-full h-full object-contain bg-gray-900"
					autoplay
					playsinline
					muted
				></video>
			</template>

			<div class="absolute top-2 left-2 w-full">
				<NamePill
					v-if="displayScreenShares.length"
					:name="getScreensharerName"
					size="sm"
					position="top-left"
				/>
			</div>
		</div>

		<!-- Sidebar - below on mobile (mt-3), right on larger screens (ml-3) -->
		<ScreenShareSidebar 
			class="mt-3 sm:mt-0 sm:ml-3" 
			@open-people-panel="emit('openPeoplePanel')" 
		/>

		<FloatingReactions
			:reactions="allReactions"
			:container-ref="screenShareContainer"
		/>
	</div>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import FloatingReactions from "./FloatingReactions.vue";
import NamePill from "./NamePill.vue";
import ScreenShareSidebar from "./ScreenShareSidebar.vue";

// Inject meeting state and functions
const emit = defineEmits(["openPeoplePanel"]);
const meetingState = inject("meetingState");
const setScreenShareVideoRef = inject("setScreenShareVideoRef");
const getParticipantName = inject("getParticipantName");

const displayScreenShares = computed(
	() => meetingState.displayScreenShares.value,
);
const currentUser = computed(() => meetingState.currentUser.value);

const getScreensharerName = computed(() => {
	const firstShare = displayScreenShares.value[0];

	if (currentUser.value?.user_id === firstShare?.participantId) {
		return `${currentUser.value?.name}'s screen`;
	}
	if (firstShare) {
		return `${getParticipantName(firstShare.participantId)}'s screen`;
	}
});

const screenShareContainer = ref(null);

const allReactions = computed(() => {
	const reactions = meetingState.reactions?.value || {};
	const allReactions = [];
	const currentUserId = currentUser.value?.user_id;

	for (const [userId, reaction] of Object.entries(reactions)) {
		if (reaction) {
			const participant =
				userId === currentUserId
					? currentUser.value
					: meetingState.participants.value[userId];
			const userName =
				participant?.user_name ||
				participant?.name ||
				participant?.user_id ||
				"Unknown";

			allReactions.push({
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
	const sorted = [...allReactions].sort((a, b) => {
		const timeDiff = b.timestamp - a.timestamp;
		if (timeDiff !== 0) return timeDiff;
		return a.userId.localeCompare(b.userId);
	});

	return sorted.slice(0, 6);
});
</script>
