<template>
  <div
    v-if="show"
    class="absolute bottom-full left-1/2 transform -translate-x-1/2 border border-gray-200 rounded shadow-lg bg-white w-64"
    ref="dropdown"
  >
    <div
      v-for="(item, index) in filteredEmojis"
      :key="item.emoji"
      class="flex items-center gap-2 p-2 hover:bg-gray-200 cursor-pointer"
      :class="{ 'bg-gray-200': index === selectedIndex }"
      @click="$emit('select', item)"
    >
      <span class="text-lg">{{ item.emoji }}</span>
      <span v-if="item.keywords?.[0]" class="text-sm text-gray-800">:{{ item.keywords[0] }}:</span>
    </div>
    <div v-if="filteredEmojis.length === 0" class="p-2 text-sm text-gray-500">
      No emojis found
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

interface EmojiItem {
	emoji: string;
	keywords: string[];
}

interface Props {
	show: boolean;
	filteredEmojis: EmojiItem[];
	selectedIndex: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	select: [item: EmojiItem];
}>();

const dropdown = ref<HTMLDivElement | null>(null);
</script>