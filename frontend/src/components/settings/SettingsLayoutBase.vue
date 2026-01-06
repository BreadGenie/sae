<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between border-outline-gray-2 px-10 py-8">
      <div class="flex flex-col gap-1">
        <h1 class="text-lg font-semibold text-ink-gray-8">
          <slot name="title">{{ title }}</slot>
        </h1>
        <p v-if="description" class="text-sm text-ink-gray-6">
          {{ description }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <slot name="header-actions" />
      </div>
    </div>
    <div class="flex-1 overflow-y-auto px-10 pb-8">
      <slot name="content" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
	title?: string;
	description?: string;
}

const props = defineProps<Props>();
</script>
