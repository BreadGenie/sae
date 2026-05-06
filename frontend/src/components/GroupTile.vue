<template>
	<div
		class="relative bg-gray-800/70 rounded-lg overflow-hidden min-h-0 flex flex-col gap-2 items-center justify-center cursor-pointer p-2"
		:title="tooltip"
		role="button"
		tabindex="0"
		@click="$emit('click')"
		@keydown.enter.prevent="$emit('click')"
		@keydown.space.prevent="$emit('click')"
	>
		<div v-if="participants && participants.length > 0" class="flex items-center justify-center">
			<div class="relative flex">
				<template v-for="(participant, index) in participants.slice(0, 2)" :key="participant.user_id">
					<div
						:class="[
							'relative ring-1 ring-gray-800/70 rounded-full overflow-hidden bg-gradient-to-br from-gray-500 to-gray-600 flex items-center justify-center',
							index > 0 ? '-ml-2' : '',
							sizeClasses
						]"
					>
						<img
							v-if="participant.avatar"
							:src="participant.avatar"
							:alt="participant.user_name || participant.user_id"
							class="w-full h-full object-cover"
						/>
						<span v-else class="font-semibold text-white" :class="textSizeClass">
							{{ participant.initials || (participant.user_name || participant.user_id).slice(0, 2).toUpperCase() }}
						</span>
					</div>
				</template>
			</div>
		</div>
		<div class="text-sm text-white text-center leading-snug">
			and {{ count }} others
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const emit = defineEmits<{
	click: [];
}>();

const props = defineProps<{
	count: number;
	tooltip?: string;
	participants?: Array<{
		user_id: string;
		user_name?: string;
		avatar?: string;
		initials?: string;
	}>;
	size?: "small" | "medium";
}>();

const sizeClasses = computed(() => {
	// Responsive sizing: smaller on mobile, larger on desktop
	return props.size === "medium"
		? "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16"
		: "w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8";
});

const textSizeClass = computed(() => {
	return props.size === "medium" ? "text-lg sm:text-xl" : "text-xs";
});
</script>
