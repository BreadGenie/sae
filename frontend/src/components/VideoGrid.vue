<template>
	<TransitionGroup
		name="tile"
		tag="div"
		class="flex-1 grid gap-2 min-h-0 call-grid transition-all duration-300 ease-out"
		:class="gridClass"
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
		/>

		<!-- Remote participants -->
		<ParticipantTile
			v-for="participant in displayParticipants.list"
			:key="'grid-' + participant.user_id"
			:participant="participant"
			:isLocal="false"
			:isVideoEnabled="participant.video_enabled"
			:isAudioEnabled="participant.audio_enabled"
			:isActiveSpeaker="activeSpeakerIds.includes(participant.user_id)"
			:videoRef="(el) => setRemoteVideoRef(participant.user_id, el)"
			:tileCount="visibleTileCount"
		/>

		<!-- Grouping tile for overflow participants -->
		<GroupTile
			v-if="displayParticipants.extra > 0"
			key="grid-group"
			:count="displayParticipants.extra"
			:tooltip="hiddenParticipantsTooltip"
		/>
	</TransitionGroup>
</template>

<script setup>
import { computed, watch } from "vue";
import { useVideoGridLayout } from "../composables/useVideoGridLayout.js";
import { getInitials } from "../utils/text";
import GroupTile from "./GroupTile.vue";
import ParticipantTile from "./ParticipantTile.vue";

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

const localParticipant = computed(() => {
	const userIdRaw = props.currentUser?.user_id;
	const fullNameRaw = props.currentUser?.full_name;
	const nameRaw = props.currentUser?.name;
	const avatarRaw = props.currentUser?.avatar;

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

// to ensure reactivity, else the grid doesn't update when activeSpeakerIds changes
const activeSpeakerIdsComputed = computed(() => props.activeSpeakerIds);

const {
	displayParticipants,
	gridClass,
	gridStyle,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useVideoGridLayout(props.participants, activeSpeakerIdsComputed);
</script>
