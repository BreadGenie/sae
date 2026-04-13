<template>
	<div
		class="group relative rounded-lg overflow-hidden min-h-0"
		:class="tileBackgroundClass"
	>
		<video
			:ref="videoRef"
			:data-participant-id="participant.user_id"
			class="block w-full h-full remote-video"
			:class="[videoObjectFitClass, videoBackgroundClass]"
			:style="{ transform: isLocal ? 'scaleX(-1) translateZ(0)' : 'translateZ(0)' }"
			autoplay
			muted
			playsinline
		/>

		<div
			v-if="showAvatar && !isVideoEnabled"
			class="absolute inset-0 flex items-center justify-center pointer-events-none"
			:class="avatarBackgroundClass"
		>
			<MeetingAvatar
				:label="participant.initials"
				:image="participant.avatar"
				:tiles="tileCount"
			/>
		</div>

		<NamePill
			:name="displayName"
			:size="labelSize"
			:position="labelPosition"
		/>

		<!-- Reaction -->
		<div
			v-if="showReaction && currentReaction"
			class="absolute top-1 px-2 py-1 rounded-md text-xl pointer-events-none animate-pop"
			:class="{ 'left-2': !isHandRaised, 'left-10': isHandRaised }"
			:aria-label="`Reaction ${currentReaction.emoji} from ${displayName}`"
			role="img"
		>
			<span class="text-2xl">{{ currentReaction.emoji }}</span>
		</div>

		<!-- Raised Hand -->
		<div
			v-if="showRaisedHand && isHandRaised"
			class="absolute top-2 left-2 px-2 py-1 rounded-full !bg-[#e54e17] text-white pointer-events-none flex items-center justify-center"
			:aria-label="`${displayName} has raised their hand`"
		>
			<lucide-hand class="w-4 h-4" :class="{ wave: isAnimating }" />
		</div>

		<div
			v-if="showAudioState && isAudioEnabled && stream"
			class="absolute top-2 right-2 rounded-full bg-gray-700 p-1.5"
		>
			<AudioIndicator
				:mediaStream="stream"
				:isActive="true"
				:maxHeight="16"
				:sensitivity="3.0"
				activeColorClass="bg-gray-100"
			/>
		</div>

		<div
			v-if="showNetworkState && showNetworkIndicator"
			class="absolute top-2 right-12 bg-gray-700 rounded-full p-1.5 ring-1 ring-gray-800"
			:title="networkQualityMessage"
		>
			<WifiAlertIcon class="w-4 h-4 text-white" />
		</div>

		<div
			v-if="showAudioState && !isAudioEnabled"
			class="absolute top-2 right-2 bg-gray-700 rounded-full p-1.5 ring-1 ring-gray-800"
		>
			<lucide-mic-off class="w-4 h-4 text-white" />
		</div>

		<!-- Participant action toolbar -->
		<div
			v-if="showActionToolbar"
			class="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-full bg-gray-700 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity ring-1 ring-gray-800"
			@click.stop
		>
			<button
				v-if="canShowPinButton"
				class="rounded-full p-1.5 hover:bg-gray-600 transition-colors"
				:class="{ 'bg-gray-600': isPinned }"
				:title="isPinned ? 'Unpin participant' : 'Pin participant'"
				@click="togglePin"
			>
				<lucide-pin-off v-if="isPinned" class="w-3.5 h-3.5" />
				<lucide-pin v-else class="w-3.5 h-3.5" />
			</button>
			<button
				v-if="canShowHostControls && isAudioEnabled"
				class="rounded-full p-1.5 hover:bg-gray-600 transition-colors"
				title="Mute participant"
				@click="handleMute"
			>
				<lucide-mic-off class="w-3.5 h-3.5" />
			</button>
			<button
				v-if="canShowHostControls"
				class="rounded-full p-1.5 hover:bg-gray-600 transition-colors"
				title="Remove participant"
				@click="showKickDialog = true"
			>
				<lucide-user-x class="w-3.5 h-3.5" />
			</button>
		</div>

		<!-- Kick Confirmation Dialog -->
		<KickParticipantDialog
			v-if="canShowHostControls"
			v-model="showKickDialog"
			:participant-name="displayName || 'this participant'"
			@confirm="handleKick"
		/>
	</div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import { useNetworkQuality } from "../composables/useNetworkQuality";
import WifiAlertIcon from "../icons/WifiAlertIcon.vue";
import AudioIndicator from "./AudioIndicator.vue";
import KickParticipantDialog from "./KickParticipantDialog.vue";
import MeetingAvatar from "./MeetingAvatar.vue";
import NamePill from "./NamePill.vue";

const meetingState = inject("meetingState");
const isCurrentUserHost = inject("isCurrentUserHost", ref(false));
const hostControls = inject("hostControls", null);

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
	labelSize: {
		type: String,
		default: "md",
	},
	labelPosition: {
		type: String,
		default: "bottom-left",
	},
	pinType: {
		type: String,
		default: "participant",
	},
	pinId: {
		type: String,
		default: null,
	},
	showPinButton: {
		type: Boolean,
		default: true,
	},
	showAvatar: {
		type: Boolean,
		default: true,
	},
	showReaction: {
		type: Boolean,
		default: true,
	},
	showRaisedHand: {
		type: Boolean,
		default: true,
	},
	showAudioState: {
		type: Boolean,
		default: true,
	},
	showNetworkState: {
		type: Boolean,
		default: true,
	},
	tileBackgroundClass: {
		type: String,
		default: "bg-gray-800",
	},
	avatarBackgroundClass: {
		type: String,
		default: "bg-gray-700",
	},
	videoObjectFitClass: {
		type: String,
		default: "object-cover",
	},
	videoBackgroundClass: {
		type: String,
		default: "",
	},
	displayName: {
		type: String,
		default: "",
	},
});

const { stream } = useAudioStream(props.participant.user_id);

const { networkQuality } = useNetworkQuality();

const displayName = computed(() => {
	return (
		props.displayName ||
		props.participant.user_name ||
		props.participant.user_id
	);
});

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
	const name = displayName.value || "This participant";

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

const isPinned = computed(() => {
	const pinned = meetingState?.pinnedTile?.value;
	const targetId = props.pinId || props.participant.user_id;
	return pinned?.type === props.pinType && pinned?.id === targetId;
});

const canShowPinButton = computed(() => {
	const targetId = props.pinId || props.participant.user_id;
	return (
		!props.isLocal &&
		props.showPinButton &&
		!!meetingState?.pinTile &&
		!!targetId
	);
});

const togglePin = () => {
	const targetId = props.pinId || props.participant.user_id;
	if (!targetId) return;
	if (isPinned.value) {
		meetingState.unpinTile();
	} else {
		meetingState.pinTile(props.pinType, targetId);
	}
};

const canShowHostControls = computed(() => {
	return !props.isLocal && isCurrentUserHost.value && !!hostControls;
});

const showActionToolbar = computed(() => {
	return canShowPinButton.value || canShowHostControls.value;
});

const showKickDialog = ref(false);

const handleMute = () => {
	hostControls?.muteParticipant(props.participant.user_id);
};

const handleKick = (ban) => {
	hostControls?.kickParticipant(props.participant.user_id, ban);
	showKickDialog.value = false;
};
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
