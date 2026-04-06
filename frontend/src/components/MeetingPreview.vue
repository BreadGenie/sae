<template>
	<div class="flex-1 flex flex-col">
		<div class="bg-gray-50 px-6 pt-4 flex-shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 cursor-pointer" @click="$router.push('/')">
					<FrappeMeetingLogo class="h-8" />
					<h4 class="text-gray-900 text-base">Frappe Meet</h4>
				</div>
				<Button
					v-if="!session.isLoggedIn"
					variant="ghost"
					size="sm"
					@click="$router.push({ name: 'Login', query: { next: $route.fullPath } })"
				>
					Sign In
				</Button>
			</div>
		</div>

		<div class="flex-1 flex lg:flex-row flex-col bg-gray-50 text-gray-900">
			<div class="max-w-7xl mx-auto w-full flex lg:flex-row flex-col">
				<!-- Video Section -->
				<div class="lg:flex-[2] flex flex-col justify-center p-6 lg:pr-4">
					<div class="max-w-3xl mx-auto w-full">
						<div
							class="relative bg-black rounded-xl overflow-hidden aspect-video shadow-xl group h-full"
						>
							<video
								:ref="(el) => setLocalVideoRef && setLocalVideoRef(el)"
								class="w-full h-full object-cover transform scale-x-[-1]"
								autoplay
								muted
								playsinline
							/>

							<div
								v-if="!isCameraOn"
								class="absolute inset-0 bg-gray-800 flex items-center justify-center"
							>
								<div class="text-center text-white">
									<MeetingAvatar
										:label="userInitials"
										:image="userAvatar"
										:tiles="1"
										class="mx-auto mb-4 w-20 h-20"
									/>
									<p class="text-xl font-medium">{{ currentUserName }}</p>
								</div>
							</div>

							<PreviewToolbar
								:isMicOn="isMicOn"
								:isCameraOn="isCameraOn"
								:cameraPermissionGranted="cameraPermissionGranted"
								:microphonePermissionGranted="microphonePermissionGranted"
								@toggle-microphone="$emit('toggle-microphone')"
								@toggle-camera="$emit('toggle-camera')"
								@device-changed="$emit('device-changed', $event)"
							/>
						</div>
					</div>
				</div>

				<!-- Join Section -->
				<div
					class="lg:flex-[1] flex items-center lg:justify-end justify-center p-6 lg:pl-4"
				>
					<div class="max-w-md w-full">
						<div class="p-8 mb-6 w-full h-full flex flex-col justify-center">
							<div class="mb-6 text-center">
								<div class="mb-4">
									<div
								class="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 bg-gradient-to-br from-blue-100 to-indigo-100"
							>
								<lucide-video class="w-8 h-8 text-blue-600" />
							</div>
						</div>

						<h2 class="text-3xl text-gray-900 mb-3">
							<span class="text-gray-900"> Ready to join? </span>
						</h2>

						<div v-if="meetingTitle" class="bg-gray-50 rounded-lg px-4 py-3 mb-4">
							<p class="text-lg font-medium text-gray-700 truncate">
								{{ meetingTitle }}
							</p>
						</div>

						<!-- Avatar group for current participants -->
						<ParticipantAvatarGroup
							v-if="!isGuest"
							:participants="participants"
							:error="presenceError"
							:maxDisplayed="3"
						/>
							</div>

							<form class="space-y-3" @submit.prevent="handleJoin">
								<FormControl
									v-if="isGuest"
									ref="guestNameInputRef"
									v-model="guestName"
									type="text"
									label="Your name"
									placeholder="John Doe"
									:maxlength="50"
									autocomplete="off"
								/>

								<Button
									type="submit"
									variant="solid"
									size="lg"
									:loading="isConnecting || joinGuestAPI.loading"
									:disabled="isGuest && !guestName.trim()"
									class="w-full"
								>
									<template #prefix>
										<lucide-video class="w-5 h-5" />
									</template>
									Join Meeting
								</Button>
							</form>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { Button, FormControl, createResource, toast } from "frappe-ui";
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import ParticipantAvatarGroup from "../components/ParticipantAvatarGroup.vue";
import PreviewToolbar from "../components/PreviewToolbar.vue";
import { useMeetingPreviewPresence } from "../composables/useMeetingPreviewPresence";
import { session } from "../data/session";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";
import MeetingAvatar from "./MeetingAvatar.vue";

const props = defineProps({
	meetingId: { type: String, required: true },
});

const guestName = ref("");

onMounted(() => {
	const savedGuestName = localStorage.getItem("guest_name");
	if (savedGuestName && !session.isLoggedIn) {
		guestName.value = savedGuestName;
	}
});
const guestNameInputRef = ref(null);

const joinGuestAPI = createResource({
	url: "meet.api.meeting.join_meeting_as_guest",
	makeParams: () => {
		return {
			meeting_id: props.meetingId,
			guest_name: guestName.value.trim(),
		};
	},
});

const meetingState = inject("meetingState");
const setLocalVideoRef = inject("setLocalVideoRef");
const meetingTitle = inject("meetingTitle");

const isGuest = computed(
	() => !session.isLoggedIn && !meetingState.guestAuthToken.value,
);

const { participants, error: presenceError } = useMeetingPreviewPresence(
	props.meetingId,
);

const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const currentUser = computed(() => meetingState.currentUser.value);
const userInitials = computed(() => {
	if (isGuest.value && guestName.value.trim()) {
		return guestName.value.trim().charAt(0).toUpperCase();
	}
	return meetingState.userInitials.value;
});
const userAvatar = computed(() => {
	if (isGuest.value) {
		return null;
	}
	return meetingState.userAvatar.value;
});
const isConnecting = computed(() => meetingState.isConnecting.value);
const cameraPermissionGranted = computed(
	() => meetingState.cameraPermissionGranted.value,
);
const microphonePermissionGranted = computed(
	() => meetingState.microphonePermissionGranted.value,
);

const emit = defineEmits([
	"toggle-microphone",
	"toggle-camera",
	"join-from-preview",
	"device-changed",
	"guest-join-complete",
]);

watch(guestNameInputRef, (inputRef) => {
	if (inputRef) {
		nextTick(() => {
			const input = inputRef.$el?.querySelector("input");
			input?.focus();
		});
	}
});

const handleJoin = async () => {
	if (joinGuestAPI.loading || isConnecting.value) {
		return;
	}

	if (isGuest.value) {
		if (!guestName.value.trim()) {
			return;
		}

		try {
			const result = await joinGuestAPI.submit();

			localStorage.setItem("guest_name", guestName.value.trim());

			meetingState.guestId.value = result.guest_id;
			meetingState.guestSfuUrl.value = result.sfu_url || null;
			meetingState.guestSfuPort.value = result.sfu_port || null;

			if (result.status === "waiting_for_approval") {
				meetingState.isWaitingForApproval.value = true;
				meetingState.guestAuthToken.value = null;
			} else {
				meetingState.guestAuthToken.value = result.auth_token || null;
				meetingState.isWaitingForApproval.value = false;
			}

			emit("guest-join-complete");
		} catch (error) {
			console.error("Failed to join as guest:", error);
			toast.error("Failed to join meeting. Please try again.");
		}
	} else {
		emit("join-from-preview");
	}
};

const currentUserName = computed(() => {
	if (isGuest.value && guestName.value.trim()) {
		return guestName.value.trim();
	}
	return currentUser.value?.full_name || currentUser.value?.name || "You";
});
</script>
