<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-x-full"
		enter-to-class="opacity-100 transform translate-x-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-x-0"
		leave-to-class="opacity-0 transform translate-x-full"
	>
		<div
			v-show="open"
			class="w-80 sm:w-96 bg-gray-900/95 border-l border-gray-800 shadow-xl flex flex-col z-40 h-full"
		>
			<div class="flex items-center justify-between px-3 py-3 border-b border-gray-800">
				<div class="text-white font-medium">Chat</div>
				<lucide-x
					@click="$emit('close')"
					class="w-4 h-4 text-white cursor-pointer hover:text-gray-300"
				/>
			</div>

			<div ref="listEl" class="flex-1 overflow-y-auto px-3 py-2 space-y-4">
				<div v-for="m in messages" :key="m.id" class="min-w-0">
					<div class="text-xs text-gray-300 flex items-center gap-2">
						<span class="truncate font-medium">{{ m.user_name }}</span>
						<span class="text-gray-500">•</span>
						<span class="text-gray-500">{{ time(m.timestamp) }}</span>
					</div>
					<div class="mt-1 text-sm text-white whitespace-pre-wrap break-words">
						{{ m.message }}
					</div>
				</div>
				<div v-if="messages.length === 0" class="text-gray-400 text-sm text-center mt-8">
					No messages yet
				</div>
			</div>

			<form class="p-2 border-t border-gray-800" @submit.prevent="handleSend">
				<div class="flex gap-2 py-2">
					<FormControl
						size="md"
						v-model="draft"
						@keydown.enter.exact.prevent="handleSend"
						placeholder="Type a message"
						class="flex-1"
					/>
					<Button size="md" type="submit" variant="outline"> Send </Button>
				</div>
			</form>
		</div>
	</Transition>
</template>

<script setup>
import { Button, FormControl } from "frappe-ui";
import { nextTick, ref, toRefs, watch } from "vue";

const props = defineProps({
	open: { type: Boolean, default: false },
	userId: { type: String, default: "" },
	userName: { type: String, default: "" },
	messages: { type: [Array, Object], default: () => [] },
});

const emit = defineEmits(["close", "send"]);
const listEl = ref(null);
const { messages } = toRefs(props);
const draft = ref("");

function time(ts) {
	try {
		return new Date(ts).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
		});
	} catch {
		return "";
	}
}

function handleSend() {
	const text = draft.value.trim();
	if (!text) return;
	emit("send", text);
	draft.value = "";
}

watch(
	messages,
	async () => {
		await nextTick();
		try {
			const el = listEl.value;
			el.scrollTop = el.scrollHeight;
		} catch {}
	},
	{ deep: true },
);
</script>
