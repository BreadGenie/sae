<template>
	<div class="relative bg-gray-800 rounded-lg overflow-hidden min-h-0">
		<video
			:ref="videoRef"
			:participant-id="participant.user_id"
			class="w-full h-full object-cover remote-video"
			:style="{ transform: isLocal ? 'scaleX(-1) translateZ(0)' : 'translateZ(0)' }"
			autoplay
			muted
			playsinline
		/>

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

		<NamePill
			:name="participant.user_name || participant.user_id"
			size="md"
			position="bottom-left"
		/>

		<!-- Reaction -->
		<div
			v-if="currentReaction"
			class="absolute top-1 px-2 py-1 rounded-md text-xl pointer-events-none animate-pop"
			:class="{ 'left-2': !isHandRaised, 'left-10': isHandRaised }"
			:aria-label="`Reaction ${currentReaction.emoji} from ${participant.user_name || participant.user_id}`"
			role="img"
		>
			<span class="text-2xl">{{ currentReaction.emoji }}</span>
		</div>

		<!-- Raised Hand -->
		<div
			v-if="isHandRaised"
			class="absolute top-2 left-2 px-2 py-1 rounded-full !bg-[#e54e17] text-white pointer-events-none flex items-center justify-center"
			:aria-label="`${participant.user_name || participant.user_id} has raised their hand`"
		>
			<lucide-hand class="w-4 h-4" :class="{ wave: isAnimating }" />
		</div>

		<div v-if="isAudioEnabled && stream" class="absolute top-2 right-2 rounded-full bg-gray-700 p-1.5">
			<AudioIndicator
				:mediaStream="stream"
				:isActive="true"
				:maxHeight="16"
				:sensitivity="3.0"
				activeColorClass="bg-gray-100"
			/>
		</div>

		<div
			v-if="showNetworkIndicator"
			class="absolute top-2 right-12 bg-gray-700 rounded-full p-1.5"
			:title="networkQualityMessage"
		>
			<WifiAlertIcon class="w-4 h-4 text-white" />
		</div>

		<div v-if="!isAudioEnabled" class="absolute top-2 right-2 bg-gray-700 rounded-full p-1.5">
			<lucide-mic-off class="w-4 h-4 text-white" />
		</div>
	</div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import { useNetworkQuality } from "../composables/useNetworkQuality";
import WifiAlertIcon from "../icons/WifiAlertIcon.vue";
import AudioIndicator from "./AudioIndicator.vue";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";

const meetingState = inject("meetingState");

const props = defineProps({
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
		default: true,
	},
	isAudioEnabled: {
		type: Boolean,
		default: true,
	},
	isActiveSpeaker: {
		type: Boolean,
		default: false,
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

const { stream } = useAudioStream(props.participant.user_id);

const { networkQuality } = useNetworkQuality();

const computedNetworkQuality = computed(() => {
	if (props.isLocal) {
		return networkQuality.value;
	}
	return props.participant.networkQuality || "good";
});

const showNetworkIndicator = computed(() => {
	return computedNetworkQuality.value !== "good";
});

const networkQualityMessage = computed(() => {
	const quality = computedNetworkQuality.value;
	const isLocal = props.isLocal;
	const name = props.participant.user_name || "This participant";

	if (quality === "critical") {
		return isLocal
			? "Your internet connection is unstable. Video and audio might lag or drop."
			: `${name}'s internet connection is unstable.`;
	}
	if (quality === "poor") {
		return isLocal
			? "Your internet connection is weak. You might notice some lag."
			: `${name}'s internet connection is weak.`;
	}
	return "";
});

const currentReaction = computed(() => {
	if (!meetingState?.reactions?.value) return null;
	return meetingState.reactions.value[props.participant.user_id] || null;
});

const isHandRaised = computed(() => {
	if (!meetingState?.raisedHands?.value) return false;
	return !!meetingState.raisedHands.value[props.participant.user_id];
});

const isAnimating = ref(false);

watch(isHandRaised, (newValue, oldValue) => {
	if (newValue && !oldValue) {
		isAnimating.value = true;
		setTimeout(() => {
			isAnimating.value = false;
		}, 1500);
	}
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

/* Reaction animation */
.animate-pop {
	animation: pop 360ms cubic-bezier(.2,.9,.3,1);
}
@keyframes pop {
	0% { transform: scale(0.75); opacity: 0 }
	60% { transform: scale(1.08); opacity: 1 }
	100% { transform: scale(1); opacity: 1 }
}
</style>
