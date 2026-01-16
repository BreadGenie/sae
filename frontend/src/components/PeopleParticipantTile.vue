<template>
	<div class="flex items-center gap-3 py-3 mx-4 border-b border-gray-200 last:border-b-0 transition-colors">
		<div class="flex-shrink-0">
			<div
				class="relative flex items-center justify-center rounded-full overflow-hidden bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-inner w-10 h-10"
			>
				<img
					v-if="participant.avatar"
					:src="participant.avatar"
					:alt="participant.user_name"
					class="w-full h-full object-cover"
					draggable="false"
				/>
				<span v-else class="font-semibold text-sm select-none">
					{{ participant.initials }}
				</span>
			</div>
		</div>

		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2">
				<span class="text-sm font-medium text-ink-black truncate">
					{{ participant.user_name }}
				</span>
				<span v-if="isCurrentUser" class="text-xs text-ink-gray-5">(You)</span>
				<Badge v-if="isHost" theme="gray" size="sm">Host</Badge>
				<Badge v-if="participant.is_guest" theme="gray" size="sm">Guest</Badge>
			</div>
		</div>

		<div class="flex items-center gap-2 flex-shrink-0">
			<!-- Raised Hand Indicator -->
			<div v-if="isHandRaised" class="w-8 h-8 flex items-center justify-center">
				<div
					class="rounded-full bg-[#e54e17] text-white p-1"
					:title="`${participant.user_name || participant.user_id} has raised their hand`"
				>
					<lucide-hand class="w-4 h-4" />
				</div>
			</div>

			<!-- Audio Indicator -->
			<div class="w-8 h-8 flex items-center justify-center">
				<lucide-mic-off v-if="!participant.audio_enabled" class="w-4 h-4 text-ink-gray-4" />
                <AudioIndicator
                    v-else-if="stream"
                    :mediaStream="stream"
                    :isActive="true"
                    :maxHeight="16"
                    :sensitivity="3.0"
                    activeColorClass="bg-gray-900"
                />
			</div>

			<!-- Video Indicator -->
			<div class="w-8 h-8 flex items-center justify-center">
				<lucide-video v-if="participant.video_enabled" class="w-4 h-4 text-ink-gray-7" />
				<lucide-video-off v-else class="w-4 h-4 text-ink-gray-4" />
			</div>

			<div v-if="showHostControls" class="relative">
				<Dropdown :options="hostOptions" placement="bottom-end">
					<template #default>
						<Button
							variant="ghost"
							size="sm"
							class="w-8 h-8"
						>
							<template #icon>
								<lucide-more-vertical class="w-4 h-4 text-ink-gray-6" />
							</template>
						</Button>
					</template>
				</Dropdown>
			</div>
            <div v-else-if="isHost" class="w-8 h-8"/>
		</div>
	</div>

	<!-- Kick Confirmation Dialog -->
	<KickParticipantDialog
		v-model="showKickDialog"
		:participant-name="participant.user_name || 'this participant'"
		@confirm="handleKickConfirm"
	/>
</template>

<script setup lang="ts">
import { Badge, Button, Dropdown } from "frappe-ui";
import { computed, inject, ref } from "vue";
import { useAudioStream } from "../composables/useAudioLevels.js";
import AudioIndicator from "./AudioIndicator.vue";
import KickParticipantDialog from "./KickParticipantDialog.vue";

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
	is_guest?: boolean;
}

interface Props {
	participant: Participant;
	isCurrentUser?: boolean;
	isHost?: boolean;
	canControlParticipant?: boolean;
	canPromoteToCohost?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	isCurrentUser: false,
	isHost: false,
	canControlParticipant: false,
	canPromoteToCohost: false,
});

const emit = defineEmits<{
	muteParticipant: [participantId: string];
	kickParticipant: [participantId: string, ban: boolean];
	lowerHand: [participantId: string];
	promoteToCohost: [participantId: string];
}>();

const { stream } = useAudioStream(props.participant.user_id);

const showKickDialog = ref(false);

const showHostControls = computed(() => {
	return props.canControlParticipant;
});

const isHandRaised = computed(() => {
	if (!meetingState?.raisedHands?.value) return false;
	return !!meetingState.raisedHands.value[props.participant.user_id];
});

const handleKickConfirm = (ban: boolean) => {
	emit("kickParticipant", props.participant.user_id, ban);
	showKickDialog.value = false;
};

const hostOptions = computed(() => {
	return [
		{
			icon: "mic-off",
			label: "Mute",
			condition: () => !!props.participant.audio_enabled,
			onClick: () => emit("muteParticipant", props.participant.user_id),
		},
		{
			icon: "slash", // TODO: switch to `hand` if we integrate Lucide instead of FeatherIcon
			label: "Lower Hand",
			condition: () => isHandRaised.value,
			onClick: () => emit("lowerHand", props.participant.user_id),
		},
		{
			icon: "user-plus",
			label: "Promote to Co-host",
			condition: () => props.canPromoteToCohost,
			onClick: () => emit("promoteToCohost", props.participant.user_id),
		},
		{
			icon: "user-x",
			label: "Remove",
			onClick: () => {
				showKickDialog.value = true;
			},
		},
	];
});
</script>
