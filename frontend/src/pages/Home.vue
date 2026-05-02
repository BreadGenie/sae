<template>
	<div class="min-h-screen bg-gray-50 flex items-center justify-center" data-testid="home-page">
		<div class="max-w-lg mx-auto text-center p-8">
			<div class="mb-20">
				<div class="flex justify-center items-center gap-4 mb-6">
					<FrappeMeetingLogo class="h-16 w-16" />
				</div>
				<h1 class="text-2xl font-bold text-gray-900 mb-4">Frappe Meet</h1>
			</div>

			<div class="space-y-6">
				<div class="space-y-3">
					<form @submit.prevent="joinMeeting" class="space-y-3" data-testid="join-meeting-form">
						<label class="block text-sm font-medium text-gray-700 text-left">
							Meeting code
						</label>
						<div class="flex gap-3 items-center">
							<div class="flex-1">
								<FormControl
									v-model="meetingCode"
									placeholder="abcd-efgh-ijkl"
									size="lg"
									class="text-center sm:text-left"
									data-testid="meeting-code-input"
								/>
							</div>
							<Button
								size="lg"
								type="submit"
								class="whitespace-nowrap px-6 py-3"
								:loading="createOrJoinCustomRoom.loading"
								:disabled="!meetingCode.trim()"
								data-testid="join-meeting-button"
							>
								Start
							</Button>
						</div>
					</form>
				</div>

				<div class="flex items-center">
					<div class="flex-grow h-px bg-gray-300"></div>
					<span class="px-4 text-sm text-gray-500">or</span>
					<div class="flex-grow h-px bg-gray-300"></div>
				</div>

				<div class="relative inline-block">
					<div class="flex items-center justify-center">
						<Button
							variant="solid"
							size="lg"
							:loading="createMeeting.loading"
							class="whitespace-nowrap px-6 py-3 rounded-r-none focus-within:z-10"
							@click="() => startNewMeeting('open')"
							data-testid="create-open-meeting-button"
						>
							<template #prefix>
								<lucide-plus class="h-4 w-4" />
							</template>
							Create an instant meeting
						</Button>

						<Dropdown
							size="lg"
							variant="solid"
							class="rounded-l-none focus-within:z-10"
							icon="chevron-down"
							:disabled="createMeeting.loading"
							data-testid="create-meeting-options"
							:options="[
								{
									icon: 'lock',
									label: 'Create a restricted meeting',
									onClick: () => startNewMeeting('restricted'),
								},
							]"
						/>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import {
	Button,
	createResource,
	Dropdown,
	FormControl,
	toast,
} from "frappe-ui";
import { ref } from "vue";
import { useRouter } from "vue-router";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const router = useRouter();
const meetingCode = ref("");

const createMeeting = createResource({
	url: "meet.api.meeting.create",
	method: "POST",
	onSuccess: (meeting_code) => {
		router.push({
			name: "Meeting",
			params: { meetingId: meeting_code },
			query: { created: "true" },
		});
	},
	onError: (error) => {
		console.error("Error creating meeting:", error);
		toast.error("Failed to create meeting. Please try again.");
	},
});

const createOrJoinCustomRoom = createResource({
	url: "meet.api.meeting.create_or_join_custom_room",
	method: "POST",
});

const startNewMeeting = (meetingType) => {
	toast.promise(createMeeting.submit({ meeting_type: meetingType }), {
		loading: "Creating meeting...",
		success: "Meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
	});
};

const joinMeeting = async () => {
	const inputValue = meetingCode.value.trim();

	if (!inputValue) {
		toast.error("Please enter a meeting code");
		return;
	}

	try {
		const response = await createOrJoinCustomRoom.submit({
			room_name: inputValue,
		});
		const meetingId = response?.meeting_id;
		if (!meetingId) {
			throw new Error("Custom room request did not return a meeting ID");
		}

		if (response.created) {
			toast.success("Custom room created successfully");
		}

		router.push({
			name: "Meeting",
			params: { meetingId: meetingId.toLowerCase() },
			query: { created: response.created ? "true" : undefined },
		});
	} catch (error) {
		const err =
			error?.messages?.length > 0
				? error.messages.join(", ")
				: "Unable to create or join room. Please try again.";
		toast.error(err);
	}
};
</script>
