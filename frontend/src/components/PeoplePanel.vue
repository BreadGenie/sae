<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-x-full"
		enter-to-class="opacity-100 transform translate-x-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-x-0"
		leave-to-class="opacity-0 transform translate-x-full"
	>
		<div v-show="open" class="h-full py-4 flex justify-end">
			<div
				class="w-80 sm:w-96 bg-white border border-gray-200 shadow-xl flex flex-col z-40 h-full rounded-lg mr-4"
			>
				<div class="flex items-center justify-between p-4 border-b border-gray-200">
					<div class="text-gray-900 font-medium">
						People ({{ totalParticipantCount }})
					</div>
					<lucide-x
						@click="$emit('close')"
						class="w-4 h-4 text-gray-900 cursor-pointer hover:text-gray-600"
					/>
				</div>

				<div class="p-4">
					<FormControl
						v-model="searchQuery"
						type="text"
						placeholder="Search people"
						autocomplete="off"
					>
						<template #prefix>
							<lucide-search class="w-4 h-4 text-ink-gray-5" />
						</template>
					</FormControl>
				</div>

				<div class="flex-1 overflow-y-auto">
					<!-- Current User -->
					<div v-if="showCurrentUser" class="border-b border-gray-200">
						<PeopleParticipantTile
							:participant="currentUserData"
							:isCurrentUser="true"
							:showHostBadge="isCreator"
							:canControlParticipant="false"
						/>
					</div>

					<!-- Remote Participants -->
					<div v-if="filteredParticipants.length > 0">
						<PeopleParticipantTile
							v-for="participant in filteredParticipants"
							:key="participant.user_id"
							:participant="participant"
							:isCurrentUser="false"
							:showHostBadge="participant.user_id === creatorUserId"
							:canControlParticipant="isCreator"
							@muteParticipant="handleMuteParticipant"
							@kickParticipant="handleKickParticipant"
							@lowerHand="handleLowerHand"
						/>
					</div>

					<div
						v-if="!showCurrentUser && filteredParticipants.length === 0"
						class="text-ink-gray-5 text-sm text-center mt-8 px-4"
					>
						{{ searchQuery ? "No participants found" : "No other participants" }}
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import { FormControl } from "frappe-ui";
import { computed, inject, ref } from "vue";
import { getInitials } from "../utils/text.ts";
import PeopleParticipantTile from "./PeopleParticipantTile.vue";

const meetingState = inject("meetingState") as {
	raisedHands?: { value: Record<string, string> };
};

interface Participant {
	user_id: string;
	user_name?: string;
	avatar?: string;
	initials?: string;
	audio_enabled?: boolean;
	video_enabled?: boolean;
}

interface CurrentUser {
	user_id?: string;
	full_name?: string;
	name?: string;
	avatar?: string;
	initials?: string;
}

interface Props {
	open: boolean;
	currentUser: CurrentUser;
	participants: Record<string, Participant>;
	isMicOn: boolean;
	isCameraOn: boolean;
	creatorUserId: string;
}

const props = withDefaults(defineProps<Props>(), {
	open: false,
	currentUser: () => ({}),
	participants: () => ({}),
	isMicOn: false,
	isCameraOn: false,
	creatorUserId: "",
});

const emit = defineEmits<{
	close: [];
	muteParticipant: [participantId: string];
	kickParticipant: [participantId: string, ban: boolean];
	lowerHand: [participantId: string];
}>();

const searchQuery = ref<string>("");

const isCreator = computed(() => {
	return props.currentUser.user_id === props.creatorUserId;
});

const participantsList = computed(() => {
	const raisedHands = meetingState?.raisedHands?.value || {};

	return Object.values(props.participants).sort((a, b) => {
		// 1. Raised hands first
		const aRaised = raisedHands[a.user_id];
		const bRaised = raisedHands[b.user_id];
		if (aRaised && !bRaised) return -1;
		if (!aRaised && bRaised) return 1;

		// 2. Among raised hands, sort by timestamp (earliest first)
		if (aRaised && bRaised) {
			const aTime = new Date(aRaised).getTime();
			const bTime = new Date(bRaised).getTime();
			return aTime - bTime;
		}

		// 3. Alphabetical by name for everyone else
		const nameA = (a.user_name || a.user_id || "").toLowerCase();
		const nameB = (b.user_name || b.user_id || "").toLowerCase();
		return nameA.localeCompare(nameB);
	});
});

const filteredParticipants = computed(() => {
	if (!searchQuery.value.trim()) {
		return participantsList.value;
	}

	const query = searchQuery.value.toLowerCase().trim();
	return participantsList.value.filter((participant) => {
		const name = (
			participant.user_name ||
			participant.user_id ||
			""
		).toLowerCase();
		return name.includes(query);
	});
});

const showCurrentUser = computed(() => {
	if (!searchQuery.value.trim()) {
		return true;
	}

	const query = searchQuery.value.toLowerCase().trim();
	const name = (
		props.currentUser?.full_name ||
		props.currentUser?.name ||
		""
	).toLowerCase();
	return name.includes(query);
});

const currentUserData = computed<Participant>(() => ({
	user_id: props.currentUser?.user_id || "",
	user_name: props.currentUser?.full_name || props.currentUser?.name || "You",
	avatar: props.currentUser?.avatar || "",
	initials: getInitials(
		props.currentUser?.full_name || props.currentUser?.name || "You",
	),
	audio_enabled: props.isMicOn,
	video_enabled: props.isCameraOn,
}));

const totalParticipantCount = computed(() => {
	return Object.keys(props.participants).length + 1;
});

const handleMuteParticipant = (participantId: string) => {
	emit("muteParticipant", participantId);
};

const handleKickParticipant = (participantId: string, ban: boolean) => {
	emit("kickParticipant", participantId, ban);
};

const handleLowerHand = (participantId: string) => {
	emit("lowerHand", participantId);
};
</script>
