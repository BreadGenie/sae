<template>
	<div class="flex-1 flex flex-col">
		<div class="bg-gray-50 px-6 pt-4 flex-shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 cursor-pointer" @click="$router.push('/')">
					<FrappeMeetingLogo class="h-8" />
					<h4 class="text-gray-900 text-base">Frappe Meet</h4>
				</div>
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

							<FloatingControls
								:isPreview="true"
								:isChatOpen="false"
								:isMicOn="isMicOn"
								:isCameraOn="isCameraOn"
								:isScreenSharing="false"
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
										class="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4"
										:class="
											isJoinRequestRejected
												? 'bg-gradient-to-br from-red-100 to-rose-100'
												: isWaitingForApproval
													? 'bg-gradient-to-br from-amber-100 to-yellow-100'
													: 'bg-gradient-to-br from-blue-100 to-indigo-100'
										"
									>
										<lucide-x-circle
											v-if="isJoinRequestRejected"
											class="w-8 h-8 text-red-600"
										/>
										<lucide-clock
											v-else-if="isWaitingForApproval"
											class="w-8 h-8 text-amber-600"
										/>
										<lucide-video v-else class="w-8 h-8 text-blue-600" />
									</div>
								</div>

								<h2 class="text-3xl text-gray-900 mb-3">
									<span v-if="isJoinRequestRejected" class="text-red-800">
										Join request denied
									</span>
									<span v-else-if="isWaitingForApproval" class="text-amber-800">
										Waiting for approval
									</span>
									<span v-else class="text-gray-900"> Ready to join? </span>
								</h2>

								<div v-if="meetingTitle" class="bg-gray-50 rounded-lg px-4 py-3 mb-4">
									<p class="text-lg font-medium text-gray-700 truncate">
										{{ meetingTitle }}
									</p>
								</div>

								<div
									v-if="isJoinRequestRejected"
									class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4"
								>
									<p class="text-sm text-red-800 leading-relaxed">
										<lucide-x-circle class="w-4 h-4 inline mr-2" />
										Your join request was denied by the meeting host.
									</p>
								</div>
								<div
									v-else-if="isWaitingForApproval"
									class="bg-amber-50 border border-amber-200 rounded-lg p-4"
								>
									<p class="text-sm text-amber-800 leading-relaxed">
										<lucide-info class="w-4 h-4 inline mr-2" />
										The meeting host will review and approve your request to
										join shortly. Please wait a moment.
									</p>
								</div>

								<!-- Avatar group for current participants -->
								<ParticipantAvatarGroup
									:participants="participants"
									:error="presenceError"
									:maxDisplayed="3"
								/>
							</div>

							<div class="space-y-3">
								<Button
									v-if="!isWaitingForApproval && !isJoinRequestRejected"
									@click="$emit('join-from-preview')"
									variant="solid"
									size="lg"
									:loading="isConnecting"
									class="w-full"
								>
									<template #prefix>
										<lucide-video class="w-5 h-5" />
									</template>
									Join Meeting
								</Button>

								<div v-if="isJoinRequestRejected" class="space-y-3">
									<Button
										@click="$emit('try-join-again')"
										variant="solid"
										size="lg"
										class="w-full"
									>
										<template #prefix>
											<lucide-refresh-cw class="w-5 h-5" />
										</template>
										Request to Join Again
									</Button>

									<Button
										@click="$emit('leave-waiting-room')"
										variant="outline"
										theme="gray"
										size="lg"
										class="w-full"
									>
										<template #prefix>
											<lucide-arrow-left class="w-4 h-4" />
										</template>
										Leave Meeting
									</Button>
								</div>

								<Button
									v-if="isWaitingForApproval"
									@click="$emit('leave-waiting-room')"
									variant="outline"
									theme="red"
									size="md"
									class="w-full"
								>
									<template #prefix>
										<lucide-x class="w-4 h-4" />
									</template>
									Leave waiting room
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from "vue";
import FloatingControls from "../components/FloatingControls.vue";
import ParticipantAvatarGroup from "../components/ParticipantAvatarGroup.vue";
import { useMeetingPreviewPresence } from "../composables/useMeetingPreviewPresence";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";
import MeetingAvatar from "./MeetingAvatar.vue";

const props = defineProps({
	meetingId: { type: String, required: true },
});

const meetingState = inject("meetingState");
const setLocalVideoRef = inject("setLocalVideoRef");
const meetingTitle = inject("meetingTitle");

const { participants, error: presenceError } = useMeetingPreviewPresence(
	props.meetingId,
);

const isCameraOn = computed(() => meetingState.isCameraOn.value);
const isMicOn = computed(() => meetingState.isMicOn.value);
const currentUser = computed(() => meetingState.currentUser.value);
const userInitials = computed(() => meetingState.userInitials.value);
const userAvatar = computed(() => meetingState.userAvatar.value);
const isConnecting = computed(() => meetingState.isConnecting.value);
const isWaitingForApproval = computed(
	() => meetingState.isWaitingForApproval.value,
);
const isJoinRequestRejected = computed(
	() => meetingState.isJoinRequestRejected.value,
);
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
	"leave-waiting-room",
	"try-join-again",
	"device-changed",
]);

const currentUserName = computed(
	() => currentUser.value?.full_name || currentUser.value?.name || "You",
);
</script>
