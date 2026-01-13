<template>
	<Dialog v-model="show" :options="{ title: 'Meeting Settings' }">
		<template #body-content>
			<div v-if="loading" class="flex justify-center py-8">
				<Spinner class="h-6 w-6" />
			</div>
			<div v-else class="space-y-6">
				<!-- Allow Guest Toggle -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<div>
							<label class="text-sm font-medium text-gray-900">Allow Guests</label>
							<p class="text-xs text-gray-600 mt-1">
								Allow non-registered users to join this meeting
							</p>
						</div>
						<Switch
							v-model="allowGuest"
							:disabled="updating || loading"
						/>
					</div>
				</div>

				<!-- Meeting Type Selector -->
				<div class="space-y-3">
					<div>
						<label class="text-sm font-medium text-gray-900">Meeting Type</label>
						<p class="text-xs text-gray-600 mt-1">
							Control who can join this meeting
						</p>
					</div>
					<FormControl
						v-model="meetingType"
						type="select"
						:options="[
							{ label: 'Open - Anyone can join directly', value: 'open' },
							{ label: 'Restricted - Requires host approval', value: 'restricted' }
						]"
						:disabled="updating || loading"
					/>
				</div>
			</div>
		</template>

		<template #actions>
			<div class="flex justify-end gap-2">
				<Button
					variant="outline"
					@click="show = false"
					:disabled="updating || loading"
				>
					Cancel
				</Button>
				<Button
					variant="solid"
					@click="saveSettings"
					:loading="updating"
					:disabled="loading"
				>
					Save Changes
				</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { Button, FormControl, Spinner, Switch, frappeRequest } from "frappe-ui";
import { toast } from "frappe-ui";
import { computed, ref, watch } from "vue";
import { useMeetingDoc } from "../composables/useMeetingDoc";

interface Props {
	modelValue: boolean;
	meetingId: string;
}

type Emits = (e: "update:modelValue", value: boolean) => void;

const props = withDefaults(defineProps<Props>(), {
	modelValue: false,
});

const emit = defineEmits<Emits>();

const show = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const allowGuest = ref<boolean>(false);
const meetingType = ref<string>("open");
const updating = ref<boolean>(false);
const loading = ref<boolean>(false);

const {
	getMeetingDoc,
	allowGuest: globalAllowGuest,
	meetingType: globalMeetingType,
} = useMeetingDoc();
const meetingDoc = getMeetingDoc(props.meetingId);

watch(
	() => props.modelValue,
	async (newValue: boolean) => {
		if (newValue && props.meetingId) {
			loading.value = true;
			try {
				allowGuest.value = globalAllowGuest.value;
				meetingType.value = globalMeetingType.value;
			} catch (error) {
				toast.error("Failed to load meeting settings");
			} finally {
				loading.value = false;
			}
		}
	},
);

const saveSettings = async (): Promise<void> => {
	updating.value = true;

	try {
		const response = await frappeRequest({
			url: "meet.api.meeting.update_meeting_settings",
			method: "POST",
			params: {
				meeting_id: props.meetingId,
				allow_guest: allowGuest.value,
				meeting_type: meetingType.value,
			},
		});

		if (response.success) {
			toast.success("Meeting settings updated successfully");
			await meetingDoc.reload();
			show.value = false;
		} else {
			toast.error(response.error || "Failed to update settings");
		}
	} catch (error) {
		console.error("Failed to update meeting settings:", error);
		toast.error("Failed to update meeting settings");
	} finally {
		updating.value = false;
	}
};
</script>
