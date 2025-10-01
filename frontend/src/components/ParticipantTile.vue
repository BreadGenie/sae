<template>
	<div class="relative bg-gray-800 rounded-lg overflow-hidden min-h-0">
		<video
			:ref="videoRef"
			:participant-id="participant.user_id"
			class="w-full h-full object-cover remote-video"
			:style="{ transform: isLocal ? 'scaleX(-1) translateZ(0)' : 'translateZ(0)' }"
			autoplay
			:muted="isLocal"
			playsinline
		/>

		<div
			class="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm pointer-events-none"
		>
			{{ participant.user_name || participant.user_id }}
		</div>

		<div
			v-if="!isVideoEnabled"
			class="absolute inset-0 bg-gray-700 flex items-center justify-center pointer-events-none"
		>
			<MeetingAvatar
				:label="participant.initials"
				:image="participant.avatar"
				:tiles="tileCount"
			/>
		</div>

		<div
			v-if="!isAudioEnabled"
			class="absolute top-2 right-2 bg-gray-700 rounded-full p-1.5"
		>
			<lucide-mic-off class="w-4 h-4 text-white" />
		</div>
	</div>
</template>

<script setup>
import MeetingAvatar from "./MeetingAvatar.vue";

defineProps({
	participant: {
		type: Object,
		required: true,
	},
	isLocal: {
		type: Boolean,
		default: false,
	},
	isVideoEnabled: {
		type: Boolean,
		default: false,
	},
	isAudioEnabled: {
		type: Boolean,
		default: true,
	},
	videoRef: {
		type: Function,
		required: true,
	},
	tileCount: {
		type: Number,
		default: 1,
	},
});
</script>

<style scoped>
/* Firefox blank video mitigation */
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

video.remote-video::-moz-focus-inner {
	border: 0;
}
</style>
