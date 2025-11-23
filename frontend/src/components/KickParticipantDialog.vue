<template>
	<Dialog
		v-model="showDialog"
		:options="{
			title: 'Remove Participant',
			size: 'sm',
			actions: [
				{
					label: 'Cancel',
					variant: 'subtle',
					onClick: () => { showDialog = false; }
				},
				{
					label: 'Remove',
					variant: 'solid',
					theme: 'red',
					onClick: handleKickConfirm
				}
			]
		}"
	>
		<template #body-content>
			<div class="space-y-4">
				<p class="text-base text-ink-gray-7">
					Are you sure you want to remove <strong>{{ participantName }}</strong> from the meeting?
				</p>
				<FormControl
					label="Ban from this meeting?"
					type="checkbox"
					v-model="banFromMeeting"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from "frappe-ui";
import { computed, ref } from "vue";

interface Props {
	participantName: string;
	modelValue?: boolean;
}

interface Emits {
	(e: "update:modelValue", value: boolean): void;
	(e: "confirm", ban: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
	modelValue: false,
});

const emit = defineEmits<Emits>();

const banFromMeeting = ref(false);

const showDialog = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const handleKickConfirm = () => {
	emit("confirm", banFromMeeting.value);
	banFromMeeting.value = false;
	showDialog.value = false;
};
</script>
