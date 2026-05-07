<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 translate-y-2"
		enter-to-class="opacity-100 translate-y-0"
		leave-active-class="transition-all duration-200 ease-in"
		leave-from-class="opacity-100 translate-y-0"
		leave-to-class="opacity-0 translate-y-2"
	>
		<div
			v-show="isCaptionsEnabled && lines.length > 0"
			class="pointer-events-none absolute inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-8"
		>
			<div class="max-w-[90%] space-y-1">
				<div
					v-for="line in visibleLines"
					:key="line.id"
					:class="[
						'block w-fit mx-auto rounded-sm px-2 py-0.5 text-center text-base font-medium text-white',
						{ 'opacity-60 italic': line.text === '...' },
					]"
					style="
						background-color: rgba(0, 0, 0, 0.65);
						text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
						line-height: 1.5;
					"
				>
					{{ line.text }}
				</div>
			</div>
		</div>
	</Transition>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
	isCaptionsEnabled: Boolean,
	lines: {
		type: Array,
		default: () => [],
	},
});

const visibleLines = computed(() => {
	return props.lines.map((line) => ({
		...line,
		id: `${line.participantId}-${line.timestamp}`,
	}));
});
</script>
