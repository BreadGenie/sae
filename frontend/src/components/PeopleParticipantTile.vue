<template>
	<div
		class="flex items-center gap-3 p-3 hover:bg-surface-gray-1 rounded-lg transition-colors"
	>
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
			</div>
		</div>

		<div class="flex items-center gap-2 flex-shrink-0">
			<!-- Audio Indicator -->
			<div class="w-8 h-8 flex items-center justify-center">
				<lucide-mic-off v-if="!isAudioEnabled" class="w-4 h-4 text-ink-gray-4" />
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
				<lucide-video v-if="isVideoEnabled" class="w-4 h-4 text-ink-gray-7" />
				<lucide-video-off v-else class="w-4 h-4 text-ink-gray-4" />
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Badge } from "frappe-ui";
import { useAudioStream } from "../composables/useAudioLevels.js";
import AudioIndicator from "./AudioIndicator.vue";

interface Participant {
	user_id: string;
	user_name?: string;
	avatar?: string;
	initials?: string;
}

interface Props {
	participant: Participant;
	isCurrentUser?: boolean;
	isHost?: boolean;
	isAudioEnabled?: boolean;
	isVideoEnabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	isCurrentUser: false,
	isHost: false,
	isAudioEnabled: true,
	isVideoEnabled: true,
});

const { stream } = useAudioStream(props.participant.user_id);
</script>
