<template>
	<PopoverRoot :open="isOpen" @update:open="updateOpen">
		<PopoverTrigger as-child>
			<slot name="trigger" />
		</PopoverTrigger>

		<PopoverPortal>
			<PopoverContent
				:side="'top'"
				:align="'center'"
				:side-offset="12"
				class="bg-black/90 rounded-2xl p-3 shadow-xl border border-white/10 max-w-sm w-full z-50"
			>
			<div class="text-center">
				<div class="grid grid-cols-5 gap-3 mb-4">
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
				<button
					@click="handleRaiseHand"
					class="w-full py-2 px-4 bg-white/10 hover:bg-opacity-100 rounded-lg transition-colors flex items-center justify-center gap-3 font-medium text-white"
					:class="{ '!bg-gray-800 hover:!bg-gray-800': isHandRaised }"
				>
					<lucide-hand class="w-5 h-5" />
					{{ isHandRaised ? "Lower Hand" : "Raise Hand" }}
				</button>
			</div>
			</PopoverContent>
		</PopoverPortal>
	</PopoverRoot>
</template>

<script setup>
import {
	PopoverContent,
	PopoverPortal,
	PopoverRoot,
	PopoverTrigger,
} from "reka-ui";

const props = defineProps({
	isOpen: {
		type: Boolean,
		default: false,
	},
	isHandRaised: {
		type: Boolean,
		default: false,
	},
});

const emit = defineEmits(["select", "update:open", "toggle-raise-hand"]);

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

const handleRaiseHand = () => {
	emit("toggle-raise-hand");
	updateOpen(false);
};

const updateOpen = (value) => {
	emit("update:open", value);
};
</script>
