<template>
	<Dialog
		v-model="show"
		:options="{
			title: 'Enter Meeting Key',
			size: 'sm',
			actions: [
				{
					label: 'Cancel',
					variant: 'ghost',
					onClick: () => emit('cancel'),
				},
				{
					label: 'Continue',
					variant: 'solid',
					onClick: () => emit('submit'),
				},
			],
		}"
	>
		<template #body-content>
			<div class="space-y-4" data-testid="e2ee-key-dialog">
				<p class="text-sm text-ink-gray-7">
					This meeting is end-to-end encrypted. Enter the shared meeting key to
					continue.
				</p>
				<FormControl
					id="e2ee-key-input"
					data-testid="e2ee-key-input"
					type="password"
					label="Meeting Key"
					autocomplete="off"
					:model-value="model"
					@update:model-value="onModelUpdate"
					@keydown.enter.prevent="$emit('submit')"
				/>
				<p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from "frappe-ui";
import { computed } from "vue";

interface Props {
	modelValue?: boolean;
	passphrase?: string;
	errorMessage?: string;
}

interface Emits {
	(e: "update:modelValue", value: boolean): void;
	(e: "update:passphrase", value: string): void;
	(e: "submit"): void;
	(e: "cancel"): void;
}

const props = withDefaults(defineProps<Props>(), {
	modelValue: false,
	passphrase: "",
	errorMessage: "",
});

const emit = defineEmits<Emits>();

const show = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const model = computed(() => props.passphrase || "");

function onModelUpdate(value: string) {
	emit("update:passphrase", value || "");
}
</script>