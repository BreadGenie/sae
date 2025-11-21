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
							:isHost="isCreator"
							:isAudioEnabled="isMicOn"
							:isVideoEnabled="isCameraOn"
						/>
					</div>

					<!-- Remote Participants -->
					<div v-if="filteredParticipants.length > 0" class="">
						<PeopleParticipantTile
							v-for="participant in filteredParticipants"
							:key="participant.user_id"
							:participant="participant"
							:isHost="participant.user_id === creatorUserId"
							:isAudioEnabled="!!participant.audio_enabled"
							:isVideoEnabled="!!participant.video_enabled"
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
import { computed, ref } from "vue";
import { getInitials } from "../utils/text.ts";
import PeopleParticipantTile from "./PeopleParticipantTile.vue";

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
	isCreator: boolean;
	creatorUserId: string;
}

const props = withDefaults(defineProps<Props>(), {
	open: false,
	currentUser: () => ({}),
	participants: () => ({}),
	isMicOn: false,
	isCameraOn: false,
	isCreator: false,
	creatorUserId: "",
});

const emit = defineEmits<{
	close: [];
}>();

const searchQuery = ref<string>("");

const participantsList = computed(() => {
	return Object.values(props.participants).sort((a, b) => {
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
}));

const totalParticipantCount = computed(() => {
	return Object.keys(props.participants).length + 1;
});
</script>
