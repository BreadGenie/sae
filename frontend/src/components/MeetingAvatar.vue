<template>
	<div class="flex items-center justify-center w-full h-full pointer-events-none">
		<div
			class="relative flex items-center justify-center rounded-full overflow-hidden bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-inner max-w-full max-h-full"
			:class="sizeClasses"
		>
			<img
				v-if="image"
				:src="image"
				alt="avatar"
				class="w-full h-full object-cover"
				draggable="false"
			/>
			<span v-else class="font-semibold select-none" :class="textClasses">
				{{ label }}
			</span>
		</div>
	</div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
	image: { type: String, default: "" },
	label: { type: String, default: "" },
	tiles: { type: Number, default: 1 }, // number of visible tiles in grid
});

// Dynamic sizing tiers based on total visible tiles
// Uses responsive classes that scale down on smaller screens
// Base sizes are for large screens, with smaller sizes for mobile/tablet
const sizeClasses = computed(() => {
	// For 1-4 tiles: larger avatars, responsive down on mobile
	if (props.tiles <= 4) return "w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28";
	// For 5-9 tiles: medium avatars
	if (props.tiles <= 9) return "w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20";
	// For 10-16 tiles: smaller avatars
	if (props.tiles <= 16) return "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16";
	// For overflow (>16 tiles): extra small
	return "w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12";
});

const textClasses = computed(() => {
	if (props.tiles <= 9) return "text-xl sm:text-2xl md:text-3xl tracking-wide";
	if (props.tiles <= 16) return "text-lg sm:text-xl";
	return "text-sm";
});
</script>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
	.pulse-soft {
		animation: pulseSoft 5s ease-in-out infinite;
	}
	@keyframes pulseSoft {
		0%,
		100% {
			transform: scale(1);
			filter: brightness(1);
		}
		50% {
			transform: scale(1.03);
			filter: brightness(1.08);
		}
	}
}
</style>
