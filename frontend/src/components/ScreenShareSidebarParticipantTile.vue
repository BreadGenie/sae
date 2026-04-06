<template>
	<div
		class="relative w-full bg-gray-800 rounded overflow-hidden flex"
		:style="tileStyle"
	>
		<video
			:ref="videoRef"
			:participant-id="participant.user_id"
			class="w-full h-full object-cover flex-1 remote-video"
			autoplay
			muted
			playsinline
		></video>
		<div
			v-if="!participant.video_enabled"
			class="absolute inset-0 flex items-center justify-center bg-gray-700"
		>
			<MeetingAvatar
				:image="participant.avatar"
				:label="participant.initials"
				:tiles="visibleTileCount"
			/>
		</div>
		<NamePill :name="participant.user_name" size="sm" position="bottom-left" />

		<div
			v-if="participant.audio_enabled && stream"
			class="absolute top-1 right-1 rounded-full bg-gray-700 p-1"
		>
			<AudioIndicator
				:mediaStream="stream"
				:isActive="true"
				:maxHeight="12"
				:sensitivity="3.0"
				activeColorClass="bg-gray-100"
			/>
		</div>
		<div
			v-else-if="!participant.audio_enabled"
			class="absolute top-1 right-1 bg-gray-700 rounded-full p-1"
		>
			<lucide-mic-off class="w-3 h-3 text-white" />
		</div>

		<div
			v-if="isHandRaised"
			class="absolute top-1 left-1 px-2 py-1 rounded-full !bg-[#e54e17] text-white pointer-events-none flex items-center justify-center"
			:aria-label="`${participant.user_name || participant.user_id} has raised their hand`"
		>
			<lucide-hand class="w-3.5 h-3.5" :class="{ wave: isAnimating }" />
		</div>
	</div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import AudioIndicator from "./AudioIndicator.vue";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";

const props = defineProps({
	participant: {
		type: Object,
		required: true,
	},
	videoRef: {
		type: Function,
		required: true,
	},
	tileStyle: {
		type: Object,
		default: () => ({}),
	},
	visibleTileCount: {
		type: Number,
		default: 1,
	},
});

const meetingState = inject("meetingState");
const { stream } = useAudioStream(props.participant.user_id);

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
