<template>
	<div class="flex-1 flex min-h-0 overflow-hidden mb-2">
		<div
			class="flex-1 relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
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

			<div class="absolute top-2 left-2">
				<NamePill
					v-if="displayScreenShares.length"
					:name="getParticipantName(displayScreenShares[0].participantId) + `'s screen`"
					size="sm"
					position="top-left"
				/>
			</div>
		</div>

		<ScreenShareSidebar
			:participants="participants"
			:currentUser="currentUser"
			:isCameraOn="isCameraOn"
			:isMicOn="isMicOn"
			:activeSpeakerIds="activeSpeakerIds"
			:setLocalVideoRef="setLocalVideoRef"
			:setRemoteVideoRef="setRemoteVideoRef"
			class="ml-3"
		/>
	</div>
</template>

<script setup>
import NamePill from "./NamePill.vue";
import ScreenShareSidebar from "./ScreenShareSidebar.vue";

const props = defineProps({
	displayScreenShares: {
		type: [Array, Object],
		required: true,
	},
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
	setScreenShareVideoRef: {
		type: Function,
		required: true,
	},
	setLocalVideoRef: {
		type: Function,
		required: true,
	},
	setRemoteVideoRef: {
		type: Function,
		required: true,
	},
	getParticipantName: {
		type: Function,
		required: true,
	},
	activeSpeakerIds: {
		type: Array,
		default: () => [],
	},
});
</script>
