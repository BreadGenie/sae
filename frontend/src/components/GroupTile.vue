<template>
	<div
		class="relative bg-gray-800/70 rounded-lg overflow-hidden min-h-0 flex items-center justify-center cursor-pointer"
		:title="tooltip"
	>
		<div class="text-sm text-white text-center px-3 leading-snug">
			and {{ count }} others
		</div>
	</div>
</template>

<script setup>
defineProps({
	count: {
		type: Number,
		required: true,
	},
	tooltip: {
		type: String,
		default: "",
	},
});
</script>
