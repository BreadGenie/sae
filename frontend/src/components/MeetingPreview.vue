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

								<div class="bg-gray-50 rounded-lg px-4 py-3 mb-4">
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

								<div
									v-else-if="!isNaN(participantsCount)"
									class="bg-blue-50 border border-blue-200 rounded-lg p-4"
								>
									<p class="text-sm text-blue-800">
										<lucide-users class="w-4 h-4 inline mr-2" />
										<span v-if="participantsCount > 0">
											{{ getParticipantText(participantsCount) }}
										</span>
										<span v-else>
											You'll be the first to join this meeting
										</span>
									</p>
								</div>
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
import { frappeRequest } from "frappe-ui";
import {
	computed,
	defineEmits,
	defineProps,
	onMounted,
	onUnmounted,
	ref,
} from "vue";
import FloatingControls from "../components/FloatingControls.vue";
import MeetingAvatar from "../components/MeetingAvatar.vue";
import { session } from "../data/session.js";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

const props = defineProps({
	isCameraOn: Boolean,
	isMicOn: Boolean,
	currentUser: Object,
	userInitials: String,
	userAvatar: String,
	isConnecting: Boolean,
	meetingTitle: { type: String, default: "" },
	meetingId: { type: String, required: true },
	setLocalVideoRef: Function,
	isWaitingForApproval: { type: Boolean, default: false },
	isJoinRequestRejected: { type: Boolean, default: false },
});

const emit = defineEmits([
	"toggle-microphone",
	"toggle-camera",
	"join-from-preview",
	"leave-waiting-room",
	"try-join-again",
	"device-changed",
]);

const participantsCount = ref(0);
let pollInterval = null;
const sfuConnection = ref(null);

const buildSFUBaseUrl = (result) => {
	return `${result.sfu_url}${result.sfu_url.startsWith("http://") ? `:${result.sfu_port}` : ""}`;
};

const fetchParticipants = async () => {
	try {
		if (!session.isLoggedIn) return;

		if (!sfuConnection.value) {
			const result = await frappeRequest({
				url: "sae.api.meeting.get_sfu_connection_details",
				params: { meeting_id: props.meetingId },
			});

			if (!result?.success) {
				throw new Error(result?.error || "Failed to get SFU details");
			}

			sfuConnection.value = buildSFUBaseUrl(result);
		}

		const roomsResponse = await fetch(`${sfuConnection.value}/rooms`);
		const roomsData = await roomsResponse.json();

		const ourRoom = roomsData.rooms.find((room) => room.id === props.meetingId);
		participantsCount.value = ourRoom ? ourRoom.peerCount : 0;
	} catch (err) {
		console.warn("Could not fetch participants count:", err?.message || err);
		try {
			if (!err?.message || /failed|network|fetch/i.test(err.message)) {
				sfuConnection.value = null;
			}
		} catch (_) {}
	}
};

onMounted(() => {
	fetchParticipants();
	pollInterval = setInterval(fetchParticipants, 10000);
});

onUnmounted(() => {
	if (pollInterval) {
		clearInterval(pollInterval);
		pollInterval = null;
	}
});

const currentUserName = computed(
	() => props.currentUser?.full_name || props.currentUser?.name || "You",
);

const getParticipantText = (count) => {
	if (count === 1) {
		return "1 user in the call";
	}
	return `${count} users in the call`;
};
</script>
