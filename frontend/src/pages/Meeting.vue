<template>
	<div class="h-screen bg-gray-900 flex flex-col" data-meeting-component>
		<!-- Loading state -->
		<div v-if="isConnecting" class="flex-1 flex items-center justify-center">
			<div class="flex items-center justify-center text-white space-x-4">
				<Spinner class="h-12" />
				<p class="text-lg">Joining meeting...</p>
			</div>
		</div>

		<!-- Error state -->
		<div v-else-if="hasConnectionError" class="flex-1 flex items-center justify-center">
			<div class="text-center text-white">
				<div class="text-red-500 mb-4">
					<lucide-alert-circle class="w-12 h-12 mx-auto" />
				</div>
				<p class="text-lg mb-4">{{ meetingState.connectionError }}</p>
				<Button @click="resetToPreview" variant="outline" theme="red">Try Again</Button>
			</div>
		</div>

		<!-- Preview mode -->
		<MeetingPreview
			v-else-if="showPreview"
			:isCameraOn="meetingState.isCameraOn.value"
			:isMicOn="meetingState.isMicOn.value"
			:currentUser="meetingState.currentUser.value"
			:userInitials="meetingState.userInitials.value"
			:userAvatar="meetingState.userAvatar.value"
			:isConnecting="meetingState.isConnecting.value"
			:meetingTitle="meetingDoc?.value?.data?.title || meetingId"
			:meetingId="meetingId"
			:setLocalVideoRef="setLocalVideoRef"
			:isWaitingForApproval="meetingState.isWaitingForApproval.value"
			:isJoinRequestRejected="meetingState.isJoinRequestRejected.value"
			@toggle-microphone="toggleMicrophone"
			@toggle-camera="toggleCamera"
			@join-from-preview="joinMeetingFromPreview"
			@leave-waiting-room="leaveWaitingRoom"
			@try-join-again="tryJoinAgain"
			@device-changed="handleDeviceChanged"
		/>

		<!-- Main meeting interface -->
		<template v-else>
			<div class="flex flex-1 min-h-0">
				<!-- Video area -->
				<div
					class="flex-1 p-4 flex flex-col min-h-0 overflow-auto text-white"
					:class="{ 'pr-2': meetingState.isChatOpen }"
				>
					<!-- Screen share active view -->
					<ScreenShareLayout
						v-if="meetingState.displayScreenShares.value.length"
						:displayScreenShares="meetingState.displayScreenShares.value"
						:participants="meetingState.participants.value"
						:currentUser="meetingState.currentUser.value"
						:isCameraOn="meetingState.isCameraOn.value"
						:isMicOn="meetingState.isMicOn.value"
						:setScreenShareVideoRef="setScreenShareVideoRef"
						:setLocalVideoRef="setLocalVideoRef"
						:setRemoteVideoRef="setRemoteVideoRef"
						:getParticipantName="meetingState.getParticipantName"
					/>

					<!-- Normal video grid -->
					<VideoGrid
						v-else
						:participants="meetingState.participants.value"
						:currentUser="meetingState.currentUser.value"
						:isCameraOn="meetingState.isCameraOn.value"
						:isMicOn="meetingState.isMicOn.value"
						:setLocalVideoRef="setLocalVideoRef"
						:setRemoteVideoRef="setRemoteVideoRef"
					/>
				</div>

				<!-- Floating controls -->
				<FloatingControls
					:isChatOpen="meetingState.isChatOpen.value"
					:hasUnread="meetingState.hasUnreadMessages.value"
					:isMicOn="meetingState.isMicOn.value"
					:isCameraOn="meetingState.isCameraOn.value"
					:isScreenSharing="meetingState.isScreenSharing.value"
					:meetingId="meetingId"
					:meetingTitle="meetingDoc?.value?.data?.title"
					@toggle-chat="toggleChat"
					@toggle-microphone="toggleMicrophone"
					@toggle-camera="toggleCamera"
					@toggle-screen-share="toggleScreenShare"
					@end-call="endCall"
					@device-changed="handleDeviceChanged"
				/>

				<!-- Chat Panel -->
				<ChatPanel
					v-if="meetingState.isChatOpen.value"
					:open="true"
					:messages="meetingState.chatMessages.value"
					:user-id="meetingState.currentUser.value?.user_id || ''"
					:user-name="
						meetingState.currentUser.value?.full_name ||
						meetingState.currentUser.value?.name ||
						'You'
					"
					@close="toggleChat"
					@send="onSendChat"
				/>
			</div>
		</template>

		<!-- Chat notifications -->
		<ChatNotificationQueue
			ref="chatNotificationQueue"
			:auto-dismiss-delay="5000"
			@notification-click="handleNotificationClick"
		/>

		<!-- Join request notifications -->
		<JoinRequestNotifications
			:waitingUsers="meetingState.waitingUsers"
			:loadingUsers="meetingState.loadingUsers"
			@approve-user="approveUser"
			@reject-user="rejectUser"
		/>
	</div>
</template>

<script setup>
import { Button, Spinner, getCachedDocumentResource } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import ChatNotificationQueue from "../components/ChatNotificationQueue.vue";
import ChatPanel from "../components/ChatPanel.vue";
import FloatingControls from "../components/FloatingControls.vue";
import JoinRequestNotifications from "../components/JoinRequestNotifications.vue";
import MeetingPreview from "../components/MeetingPreview.vue";
import ScreenShareLayout from "../components/ScreenShareLayout.vue";
// Components
import VideoGrid from "../components/VideoGrid.vue";

import { useMeetingLogic } from "../composables/useMeetingLogic.js";
// Composables and utilities
import { useMeetingState } from "../composables/useMeetingState.js";
import {
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
} from "../data/mediaPreferences.js";
import { session } from "../data/session.js";
import { deviceManager } from "../utils/media/DeviceManager.js";

// Router access
const route = useRoute();
const router = useRouter();
const meetingId = computed(() => route.params.meetingId);

// Meeting state management
const meetingState = useMeetingState();

// Meeting logic composable
const {
	initializeCamera,
	joinMeetingRoom,
	toggleMicrophone,
	toggleCamera,
	toggleScreenShare,
	endCall,
	approveUser,
	rejectUser,
	setLocalVideoRef,
	setRemoteVideoRef,
	setScreenShareVideoRef,
	onSendChat,
	setupChatEvents,
	handleKeyDown,
	sfuManager,
} = useMeetingLogic(meetingState, meetingId.value);

// Computed properties
const isConnecting = computed(() => meetingState.isConnecting.value);
const hasConnectionError = computed(() => !!meetingState.connectionError.value);
const showPreview = computed(() => {
	const inPreview = meetingState.isInPreview.value;
	const waitingForApproval = meetingState.isWaitingForApproval.value;
	const joinRequestRejected = meetingState.isJoinRequestRejected.value;
	return inPreview || waitingForApproval || joinRequestRejected;
});

// Add a watcher to debug state changes
// State watcher removed after debugging

const meetingDoc = getCachedDocumentResource("Sae Meeting", meetingId.value);

// Refs
const chatNotificationQueue = ref(null);

// Methods
const resetToPreview = () => {
	meetingState.connectionError.value = null;
	meetingState.isConnecting.value = false;
	meetingState.isInPreview.value = true;
	// Reset to preview state
};

const joinMeetingFromPreview = async () => {
	await joinMeetingRoom();
};

const leaveWaitingRoom = () => {
	meetingState.isWaitingForApproval.value = false;
	meetingState.isJoinRequestRejected.value = false;
	router.push({ name: "Home" });
};

const tryJoinAgain = async () => {
	meetingState.isJoinRequestRejected.value = false;
	await joinMeetingRoom();
};

const toggleChat = () => {
	meetingState.isChatOpen.value = !meetingState.isChatOpen.value;
	if (meetingState.isChatOpen.value) {
		meetingState.hasUnreadMessages.value = false;
	}
};

const handleNotificationClick = () => {
	if (!meetingState.isChatOpen.value) {
		toggleChat();
	}
};

const setSinkIdOnVideoElements = async (sinkId) => {
	// Set speaker output on all video elements
	const videoElements = document.querySelectorAll("video");

	if (videoElements.length === 0) {
		console.warn("⚠️ No video elements found yet");
	}

	const promises = [];
	for (const videoEl of videoElements) {
		const promise = videoEl
			.setSinkId(sinkId)
			.then(() => {
				console.log(
					"✅ Successfully set speaker for video element to:",
					sinkId,
				);
			})
			.catch((error) => {
				console.error("❌ Failed to set speaker for video element:", error);
			});
		promises.push(promise);
	}

	await Promise.all(promises);
	console.log("🔊 Finished setting speaker on all video elements");
};

const handleDeviceChanged = async (event) => {
	console.log("🔄 Device changed:", event);

	if (event.type === "speaker") {
		const speakerId = event.deviceId;

		if (speakerId) {
			await setSinkIdOnVideoElements(speakerId);
		}
		return;
	}

	if (meetingState.isCameraOn.value || meetingState.isMicOn.value) {
		try {
			// Stop old tracks else we won't release the camera/mic
			const oldStream = meetingState.localStream.value;
			if (oldStream) {
				for (const track of oldStream.getTracks()) {
					track.stop();
				}
			}

			const constraints = {};

			if (meetingState.isCameraOn.value) {
				constraints.video = {};
				// Use the deviceId from the event if it's a camera change, otherwise use current selection
				const cameraDeviceId =
					event.type === "camera" ? event.deviceId : selectedCameraId.value;
				if (
					cameraDeviceId &&
					deviceManager.isDeviceAvailable(cameraDeviceId, "camera")
				) {
					constraints.video.deviceId = { exact: cameraDeviceId };
				}
			}

			if (meetingState.isMicOn.value) {
				constraints.audio = {};
				const micDeviceId =
					event.type === "microphone" ? event.deviceId : selectedMicId.value;
				if (
					micDeviceId &&
					deviceManager.isDeviceAvailable(micDeviceId, "microphone")
				) {
					constraints.audio.deviceId = { exact: micDeviceId };
				}
			}

			// use new device
			const newStream = await navigator.mediaDevices.getUserMedia(constraints);
			meetingState.localStream.value = newStream;

			if (meetingState.localVideo) {
				meetingState.localVideo.srcObject = newStream;
			}

			if (sfuManager.value?.mediaHandler) {
				const mh = sfuManager.value.mediaHandler;

				if (mh.audioProducer && newStream.getAudioTracks().length > 0) {
					const audioTrack = newStream.getAudioTracks()[0];
					await mh.audioProducer.replaceTrack({ track: audioTrack });
				}

				if (mh.videoProducer && newStream.getVideoTracks().length > 0) {
					const videoTrack = newStream.getVideoTracks()[0];
					await mh.videoProducer.replaceTrack({ track: videoTrack });
				}
			}
		} catch (error) {
			console.error("❌ Failed to update media with new device:", error);
		}
	}
};

// Lifecycle
onMounted(async () => {
	window.addEventListener("keydown", handleKeyDown);

	// Clear any stale error/connection state from previous navigations
	if (typeof meetingState.resetConnectionState === "function") {
		meetingState.resetConnectionState();
		// Reset meeting connection state on mount
	} else {
		// Fallback: minimally clear error
		if (meetingState.connectionError?.value) {
			meetingState.connectionError.value = null;
			// Cleared connectionError on mount
		}
	}

	// Initialize meeting
	if (!session.isLoggedIn) {
		router.push({ name: "Login" });
		return;
	}

	// Setup current user (ensure we assign strings, not reactive objects)
	meetingState.currentUser.value = {
		user_id: session.user?.sessionUser || "",
		name: session.user?.full_name || session.user?.sessionUser || "",
		full_name: session.user?.full_name || "",
		avatar: session.user?.avatar || "",
	};

	// Initialize camera
	await initializeCamera();

	if (selectedSpeakerId.value) {
		await setSinkIdOnVideoElements(selectedSpeakerId.value);
	}

	// Setup chat events
	setupChatEvents(chatNotificationQueue.value);

	// Auto-join if just created
	const wasJustCreated = route.query.created === "true";
	if (wasJustCreated) {
		await joinMeetingFromPreview();
	}
});

onUnmounted(() => {
	window.removeEventListener("keydown", handleKeyDown);

	// Cleanup will be handled by the meeting logic composable
});

// Watch for meetingId and initialize meetingDoc
watch(
	meetingId,
	async (newMeetingId) => {
		if (newMeetingId && meetingDoc) {
			try {
				await meetingDoc.submit();
			} catch (error) {
				console.error("Failed to load meeting document:", error);
			}
		}
	},
	{ immediate: true },
);

// Watch for localVideo element and localStream connection
watch(
	[() => meetingState.localVideo, () => meetingState.localStream],
	async ([videoElement, stream]) => {
		if (videoElement && stream) {
			try {
				videoElement.srcObject = stream;
				await videoElement.play();

				if (
					selectedSpeakerId.value &&
					typeof videoElement.setSinkId === "function"
				) {
					try {
						await videoElement.setSinkId(selectedSpeakerId.value);
					} catch (error) {
						console.warn("⚠️ Could not set speaker for local video:", error);
					}
				}
			} catch (error) {
				console.warn("⚠️ Could not play local video:", error);
			}
		}
	},
	{ immediate: true },
);

watch(selectedSpeakerId, async (newSpeakerId) => {
	if (
		newSpeakerId &&
		deviceManager.isDeviceAvailable(newSpeakerId, "speaker")
	) {
		await setSinkIdOnVideoElements(newSpeakerId);
	}
});
</script>

<style scoped>
/* Transition styles for participant tiles */
.tile-enter-from,
.tile-leave-to {
	opacity: 0;
	transform: scale(0.85) translateY(8px);
}

.tile-enter-active,
.tile-leave-active {
	transition:
		opacity 200ms ease,
		transform 200ms ease;
}

.tile-move {
	transition: transform 200ms ease;
}

.tile-leave-active {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
</style>
