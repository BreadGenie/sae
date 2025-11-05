<template>
	<PopoverRoot :open="isOpen" @update:open="updateOpen">
		<PopoverTrigger as-child>
			<slot name="trigger" />
		</PopoverTrigger>

		<PopoverContent
			:side="'top'"
			:align="'center'"
			:side-offset="12"
			class="bg-black/90 rounded-2xl p-6 shadow-xl border border-white/10 max-w-sm w-full"
		>
			<div class="text-center">
				<div class="grid grid-cols-5 gap-2">
					<button
						v-for="emoji in reactionEmojis"
						:key="emoji"
						@click="handleReactionSelect(emoji)"
						class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-2xl"
						:aria-label="`Send ${emoji} reaction`"
					>
						{{ emoji }}
					</button>
				</div>
			</div>
		</PopoverContent>
	</PopoverRoot>
</template>

<script setup>
import { PopoverContent, PopoverRoot, PopoverTrigger } from "reka-ui";

const props = defineProps({
	isOpen: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(["select", "update:open"]);

const reactionEmojis = [
	"👍",
	"👎",
	"💖",
	"🎉",
	"😂",
	"👏",
	"🤔",
	"😮",
	"😢",
	"😡",
	"🤝",
	"✨",
	"🔥",
	"💯",
	"🙏",
];

const handleReactionSelect = (emoji) => {
	emit("select", emoji);
};

const updateOpen = (value) => {
	emit("update:open", value);
};
</script>
