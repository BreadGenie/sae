<template>
	<div class="relative rounded-lg border-2 border-gray-200 bg-gray-100 p-3">
		<div class="select-all break-all text-xs text-gray-800">
			<pre
				:class="{
					'whitespace-pre-wrap': breakLines,
					'overflow-x-auto': !breakLines,
				}"
				:style="
					!breakLines
						? 'scrollbar-width: none; -ms-overflow-style: none; -webkit-scrollbar: none;'
						: ''
				"
				>{{ textContent }}</pre>
		</div>
		<button
			type="button"
			class="absolute right-2 top-2 rounded-sm border border-gray-200 bg-white p-1 text-xs text-gray-600"
			variant="outline"
			@click="copyTextContentToClipboard"
		>
			{{ copied ? "copied" : "copy" }}
		</button>
	</div>
</template>

<script setup lang="ts">
import { toast } from "frappe-ui";
import { ref } from "vue";

const props = defineProps<{
	textContent: string;
	breakLines?: boolean;
}>();

const copied = ref(false);

function copyTextContentToClipboard() {
	const clipboard = window.navigator.clipboard;
	clipboard.writeText(props.textContent).then(() => {
		copied.value = true;
		setTimeout(() => {
			copied.value = false;
		}, 4000);
		toast.success("Copied to clipboard!");
	});
}
</script>
