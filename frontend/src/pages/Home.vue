<template>
	<div class="min-h-screen bg-gray-50 flex items-center justify-center">
		<div class="max-w-lg mx-auto text-center p-8">
			<div class="mb-20">
				<div class="flex justify-center items-center gap-4 mb-6">
					<FrappeMeetingLogo class="h-16 w-16" />
				</div>
				<h1 class="text-2xl font-bold text-gray-900 mb-4">Frappe Meet</h1>
			</div>

			<div class="space-y-6">
				<div class="space-y-3">
					<form @submit.prevent="joinMeeting" class="space-y-3">
						<label class="block text-sm font-medium text-gray-700 text-left">
							Join with Meeting Code
						</label>
						<div class="flex gap-3 items-center">
							<div class="flex-1">
								<FormControl
									v-model="meetingCode"
									placeholder="abcd-efgh-ijkl"
									size="lg"
									:error="meetingCodeError"
									class="text-center sm:text-left"
								/>
							</div>
							<Button
								size="lg"
								type="submit"
								class="whitespace-nowrap px-6 py-3"
								:disabled="!isMeetingCodeValid(meetingCode)"
							>
								Join
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
							class="whitespace-nowrap px-6 py-3 rounded-r-none"
							@click="() => startNewMeeting('open')"
						>
							<template #prefix>
								<lucide-plus class="h-4 w-4" />
							</template>
							Start new meeting
						</Button>

						<Dropdown
							size="lg"
							variant="solid"
							class="rounded-l-none"
							icon="chevron-down"
							:disabled="createMeeting.loading"
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
	Dropdown,
	FormControl,
	createResource,
	toast,
} from "frappe-ui";
import { ref } from "vue";
import { useRouter } from "vue-router";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const router = useRouter();
const meetingCode = ref("");
const meetingCodeError = ref("");

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

const startNewMeeting = (meetingType) => {
	toast.promise(createMeeting.submit({ meeting_type: meetingType }), {
		loading: "Creating meeting...",
		success: "Meeting created successfully!",
		error: "Failed to create meeting. Please try again.",
	});
};

const joinMeeting = () => {
	meetingCodeError.value = "";

	if (!meetingCode.value.trim()) {
		meetingCodeError.value = "Please enter a meeting code";
		return;
	}

	if (!isMeetingCodeValid(meetingCode.value.trim())) {
		meetingCodeError.value =
			"Please enter a valid meeting code (format: xxxx-xxxx-xxxx)";
		return;
	}

	router.push({
		name: "Meeting",
		params: { meetingId: meetingCode.value.trim() },
	});
};

const isMeetingCodeValid = (code) => {
	// Ensure code is of the form xxxx-xxxx-xxxx
	const regex = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;
	return regex.test(code);
};
</script>
