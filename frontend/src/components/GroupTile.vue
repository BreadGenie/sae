<template>
	<Tooltip :label="tooltip" :text="tooltip" placement="top">
		<div
			class="relative bg-gray-800/70 rounded-lg overflow-hidden min-h-0 flex items-center justify-center cursor-pointer"
		>
			<div class="text-sm text-white text-center px-3 leading-snug">
				and {{ count }} others
			</div>
		</div>
	</Tooltip>
</template>

<script setup>
import { Tooltip } from "frappe-ui";

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
