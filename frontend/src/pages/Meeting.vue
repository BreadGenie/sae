<template>
	<div class="h-[100dvh] bg-gray-900 flex flex-col" data-meeting-component>
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
			:meetingId="meetingId"
			@toggle-microphone="toggleMicrophone"
			@toggle-camera="toggleCamera"
			@join-from-preview="joinMeetingFromPreview"
			@guest-join-complete="handleGuestJoinComplete"
			@leave-waiting-room="leaveWaitingRoom"
			@try-join-again="tryJoinAgain"
			@device-changed="handleDeviceChanged"
		/>

		<!-- Main meeting interface -->
		<template v-else>
			<div class="flex flex-1 min-h-0">
				<div
					class="grid flex-1 min-h-0 transition-[grid-template-columns] duration-300 ease-out relative"
					:style="{
						'--panel-width': panelWidth,
						gridTemplateColumns: 'minmax(0, 1fr) var(--panel-width)',
					}"
				>
					<!-- Video column: video area + toolbar -->
					<div class="flex flex-col min-h-0">
						<!-- Video area -->
						<div class="p-4 flex flex-col flex-1 min-h-0 text-white">
							<MeetingLayout @open-people-panel="togglePeople" />
						</div>

						<!-- Meeting controls -->
						<MeetingToolbar
							:isChatOpen="meetingState.isChatOpen.value"
							:isPeopleOpen="meetingState.isPeopleOpen.value"
							:hasUnread="meetingState.hasUnreadMessages.value"
							:lobbyUserCount="meetingState.lobbyUsers?.value?.length || 0"
							:isMicOn="meetingState.isMicOn.value"
							:isCameraOn="meetingState.isCameraOn.value"
							:isScreenSharing="meetingState.isScreenSharing.value"
							:isFullscreen="isFullscreen"
							:isHandRaised="isHandRaised"
							:isReactionPickerOpen="isReactionPickerOpen"
							@update:isReactionPickerOpen="isReactionPickerOpen = $event"
							:meetingId="meetingId"
							:meetingTitle="meetingTitle.value"
							:currentUser="meetingState.currentUser.value"
							:cameraPermissionGranted="meetingState.cameraPermissionGranted.value"
							:microphonePermissionGranted="meetingState.microphonePermissionGranted.value"
							@toggle-chat="toggleChat"
							@toggle-people="togglePeople"
							@toggle-reactions="toggleReactions($event)"
							@toggle-microphone="toggleMicrophone"
							@toggle-camera="toggleCamera"
							@toggle-screen-share="toggleScreenShare"
							@toggle-fullscreen="toggleFullscreen"
							@toggle-raise-hand="toggleRaiseHand"
							@end-call="endCall"
							@device-changed="handleDeviceChanged"
						/>
					</div>

					<!-- Panel Container -->
					<Transition
						enter-active-class="transition-all duration-300 ease-out"
						enter-from-class="opacity-0 transform translate-x-full w-0"
						enter-to-class="opacity-100 transform translate-x-0"
						leave-active-class="transition-all duration-300 ease-in"
						leave-from-class="opacity-100 transform translate-x-0"
						leave-to-class="opacity-0 transform translate-x-full"
					>
						<div
							v-if="activePanel"
							class="h-full overflow-hidden z-50 md:z-auto bg-black/30 backdrop-blur-sm md:bg-transparent"
							:class="{
								'absolute inset-0 w-full': isMobile,
								relative: !isMobile,
								'md:relative': true,
							}"
							:style="{ width: isMobile ? '100%' : '24rem' }"
						>
							<!-- Chat Panel -->
							<ChatPanel
								v-if="activePanel === 'chat'"
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

							<!-- People Panel -->
							<PeoplePanel
								v-if="activePanel === 'people'"
								:open="true"
								:currentUser="meetingState.currentUser.value"
								:participants="meetingState.participants.value"
								:isMicOn="meetingState.isMicOn.value"
								:isCameraOn="meetingState.isCameraOn.value"
								:creatorUserId="creatorUserId"
								:coHosts="meetingCoHosts"
								@close="togglePeople"
								@muteParticipant="handleMuteParticipant"
								@kickParticipant="handleKickParticipant"
								@lowerHand="handleLowerHand"
								@promoteToCohost="handlePromoteToCohost"
								@approveLobbyUser="handleApproveLobbyUser"
								@approveAllLobbyUsers="handleApproveAllLobbyUsers"
								@rejectLobbyUser="handleRejectLobbyUser"
							/>
						</div>
					</Transition>
				</div>
			</div>

			<LobbyOverlay
				v-if="(isInLobby || isWaitingForApproval) && !isRejected"
				@leave="leaveLobby"
			/>

			<RejectionOverlay
				v-if="isRejected && isGuestSession"
				@leave="goHome"
			/>
		</template>

		<!-- Chat notifications -->
		<ChatNotificationQueue
			ref="chatNotificationQueue"
			:auto-dismiss-delay="5000"
			@notification-click="handleNotificationClick"
		/>

		<!-- Join request notifications -->
		<JoinRequestNotifications
			:waitingUsers="lobbyUsersForNotifications"
			@approve-user="approveUser"
			@reject-user="rejectUser"
		/>
	</div>
</template>

<script setup>
import { Button, frappeRequest } from "frappe-ui";
import { computed, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import ChatNotificationQueue from "../components/ChatNotificationQueue.vue";
import ChatPanel from "../components/ChatPanel.vue";
import JoinRequestNotifications from "../components/JoinRequestNotifications.vue";
import LobbyOverlay from "../components/LobbyOverlay.vue";
import MeetingLayout from "../components/MeetingLayout.vue";
import MeetingPreview from "../components/MeetingPreview.vue";
import MeetingToolbar from "../components/MeetingToolbar.vue";
import PeoplePanel from "../components/PeoplePanel.vue";
import RejectionOverlay from "../components/RejectionOverlay.vue";
import Spinner from "../components/Spinner.vue";

import { provideMeetingContext } from "../composables/useMeetingContext.js";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import { useMeetingLogic } from "../composables/useMeetingLogic.js";
import { useMeetingState } from "../composables/useMeetingState.js";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
import {
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
} from "../data/mediaPreferences";
import { session } from "../data/session.js";
import { useSocket } from "../socket.js";
import { deviceManager } from "../utils/media/DeviceManager.js";
import { getSFUClient } from "../utils/sfu-client.js";

// Router access
const route = useRoute();
const router = useRouter();
const meetingId = computed(() => route.params.meetingId);

// Meeting state management
const meetingState = useMeetingState();
const socket = useSocket();

// Lobby user notification tracking
const notifiedLobbyUsers = ref(new Set());

const {
	getMeetingDoc,
	meetingTitle,
	meetingOwner,
	isCurrentUserHost,
	meetingCoHosts,
} = useMeetingDoc();

const meetingDoc = getMeetingDoc(meetingId.value);

// Meeting logic composable
const {
	initializeCamera,
	acquireUserMedia,
	joinMeetingRoom,
	toggleMicrophone,
	toggleCamera,
	toggleScreenShare,
	endCall,
	approveUser,
	approveAllUsers,
	rejectUser,
	setLocalVideoRef,
	setRemoteVideoRef,
	setScreenShareVideoRef,
	onSendChat,
	setupChatEvents,
	setupReactionEvents,
	setupRaiseHandEvents,
	toggleRaiseHand,
	handleKeyDown,
	handleKeyUp,
	sfuManager,
	applySpeakerDevice,
	processedStream,
	applyBackgroundEffectsToLocalStream,
	onSendReaction,
} = useMeetingLogic(meetingState, meetingId.value, {
	notifiedLobbyUsers,
});

const isGuestSession = computed(
	() =>
		!session.isLoggedIn &&
		(!!meetingState.guestAuthToken.value ||
			meetingState.isWaitingForApproval.value),
);

// Provide meeting context for child components
provideMeetingContext({
	processedStream,
	isInMeeting: computed(() => true),
	onBackgroundEffectsChanged: applyBackgroundEffectsToLocalStream,
});

provide("setLocalVideoRef", setLocalVideoRef);
provide("setRemoteVideoRef", setRemoteVideoRef);
provide("setScreenShareVideoRef", setScreenShareVideoRef);
provide("getParticipantName", meetingState.getParticipantName);
provide("meetingState", meetingState);
provide("meetingId", meetingId.value);
provide("sfuManager", sfuManager);
provide("socket", socket);
provide("isCurrentUserHost", isCurrentUserHost);
provide("hostControls", {
	muteParticipant: (...args) => handleMuteParticipant(...args),
	kickParticipant: (...args) => handleKickParticipant(...args),
});
provide(
	"meetingTitle",
	computed(() => {
		if (!session.isLoggedIn) {
			return meetingId.value;
		}
		return meetingTitle.value;
	}),
);

// Computed properties
const isConnecting = computed(() => meetingState.isConnecting.value);
const hasConnectionError = computed(() => !!meetingState.connectionError.value);
const isInLobby = computed(() => meetingState.isInLobby?.value || false);
const isWaitingForApproval = computed(
	() => meetingState.isWaitingForApproval?.value || false,
);
const isRejected = computed(
	() => meetingState.isJoinRequestRejected?.value || false,
);
const showPreview = computed(() => {
	const isUnauthenticatedGuest = !session.isLoggedIn && !isGuestSession.value;
	if (isUnauthenticatedGuest) {
		return true;
	}

	if (isGuestSession.value) {
		return false;
	}
	if (meetingState.isInLobby?.value) {
		return false;
	}
	if (meetingState.isWaitingForApproval?.value) {
		return false;
	}
	const inPreview = meetingState.isInPreview.value;
	const joinRequestRejected = meetingState.isJoinRequestRejected.value;
	return inPreview || joinRequestRejected;
});

const activePanel = computed(() => {
	if (meetingState.isChatOpen.value) return "chat";
	if (meetingState.isPeopleOpen.value) return "people";
	if (meetingState.isPeopleOpen.value) return "people";
	return null;
});

const { windowWidth } = useResponsiveGrid();
const isMobile = computed(() => windowWidth.value < 768);

const panelWidth = computed(() => {
	if (!activePanel.value) return "0rem";
	// On mobile, panel overlays, so it doesn't take up grid space
	if (isMobile.value) return "0rem";
	return "24rem";
});

const isHandRaised = computed(() => {
	const currentUserId = meetingState.currentUser.value?.user_id;
	return currentUserId
		? !!meetingState.raisedHands.value?.[currentUserId]
		: false;
});

const creatorUserId = computed(() => meetingOwner.value);

const lobbyUsersForNotifications = computed(() => {
	return meetingState.lobbyUsers.value
		.filter((user) => !notifiedLobbyUsers.value.has(user.userId))
		.map((user) => ({
			user_id: user.userId,
			user_name: user.name,
			user_image: user.avatar,
		}));
});

// Refs
const chatNotificationQueue = ref(null);
const isReactionPickerOpen = ref(false);
const isFullscreen = ref(false);

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

const handleGuestJoinComplete = async () => {
	const guestId = meetingState.guestId.value;
	const guestName = localStorage.getItem("guest_name");

	if (guestId && guestName) {
		meetingState.currentUser.value = {
			user_id: guestId,
			name: guestName,
			full_name: guestName,
			avatar: null,
			is_guest: true,
		};
	}

	await joinMeetingRoom(guestName);
};

const leaveWaitingRoom = () => {
	meetingState.isWaitingForApproval.value = false;
	meetingState.isJoinRequestRejected.value = false;
	router.push({ name: "Home" });
};

const leaveLobby = async () => {
	const sfuClient = getSFUClient();
	if (sfuClient?.isInLobby?.()) {
		await sfuClient.leaveLobby();
		sfuClient.disconnect();
	}

	meetingState.isInLobby.value = false;
	meetingState.isWaitingForApproval.value = false;
	meetingState.lobbyParticipantCount.value = 0;

	router.push({ name: "Home" });
};

const goHome = () => {
	meetingState.isJoinRequestRejected.value = false;
	meetingState.isInLobby.value = false;

	router.push({ name: "Home" });
};

const tryJoinAgain = async () => {
	meetingState.isJoinRequestRejected.value = false;

	if (isGuestSession.value) {
		meetingState.isInPreview.value = true;
		return;
	}

	await joinMeetingRoom();
};

const toggleReactions = (payload) => {
	onSendReaction(payload);
	isReactionPickerOpen.value = false;
};

const toggleChat = () => {
	meetingState.isChatOpen.value = !meetingState.isChatOpen.value;
	if (meetingState.isChatOpen.value) {
		meetingState.hasUnreadMessages.value = false;
		// Close people panel when opening chat
		meetingState.isPeopleOpen.value = false;
	}
};

const togglePeople = () => {
	meetingState.isPeopleOpen.value = !meetingState.isPeopleOpen.value;
	if (meetingState.isPeopleOpen.value) {
		// Close chat when opening people panel
		meetingState.isChatOpen.value = false;
	}
};

const handleMuteParticipant = async (participantId) => {
	try {
		console.log("Muting participant:", participantId);

		if (sfuManager.value?.sfuClient) {
			sfuManager.value.sfuClient.sendEvent("host_control", {
				action: "mute_participant",
				targetParticipantId: participantId,
			});
		} else {
			console.error("SFU client not available");
		}

		// Note: the remote participant will receive `host_control_update` event
		// and that will handle muting their microphone
	} catch (error) {
		console.error("Failed to mute participant:", error);
	}
};

const handleKickParticipant = async (participantId, ban = false) => {
	try {
		if (ban) {
			try {
				await meetingDoc.setValue.submit({
					banned_users: [
						...(meetingDoc.doc?.banned_users || []),
						{ user: participantId },
					],
				});
			} catch (error) {
				console.error("Failed to ban user:", error);
			}
		}

		if (sfuManager.value?.sfuClient) {
			sfuManager.value.sfuClient.sendEvent("host_control", {
				action: "kick_participant",
				targetParticipantId: participantId,
			});
		} else {
			console.error("SFU client not available");
		}
	} catch (error) {
		console.error("Failed to kick participant:", error);
	}
};

const handleLowerHand = async (participantId) => {
	try {
		console.log("Lowering hand for participant:", participantId);

		if (sfuManager.value?.sfuClient) {
			sfuManager.value.sfuClient.sendEvent("host_control", {
				action: "lower_hand",
				targetParticipantId: participantId,
			});
		} else {
			console.error("SFU client not available");
		}
	} catch (error) {
		console.error("Failed to lower hand for participant:", error);
	}
};

const handlePromoteToCohost = async (participantId) => {
	try {
		console.log("Promoting participant to co-host:", participantId);

		const response = await frappeRequest({
			url: "meet.api.meeting.promote_to_cohost",
			params: {
				meeting_id: route.params.meetingId,
				user_id: participantId,
			},
		});

		if (response?.meeting_id) {
			toast.success("User promoted to co-host");
			await meetingDoc.reload();
		}
	} catch (error) {
		console.error("Failed to promote participant to co-host:", error);
		toast.error("Failed to promote user to co-host");
	}
};

const handleApproveLobbyUser = async (participantId) => {
	try {
		console.log("Approving lobby user:", participantId);

		await approveUser(participantId);
		notifiedLobbyUsers.value.add(participantId);
	} catch (error) {
		console.error("Failed to approve lobby user:", error);
	}
};

const handleApproveAllLobbyUsers = async (participantIds) => {
	try {
		console.log("Approving all lobby users");

		await approveAllUsers(participantIds);
		for (const userId of participantIds) {
			notifiedLobbyUsers.value.add(userId);
		}
	} catch (error) {
		console.error("Failed to approve all lobby users:", error);
	}
};

const handleRejectLobbyUser = async (participantId) => {
	try {
		console.log("Rejecting lobby user:", participantId);

		await rejectUser(participantId);
		notifiedLobbyUsers.value.add(participantId);
	} catch (error) {
		console.error("Failed to reject lobby user:", error);
	}
};

const handleNotificationClick = () => {
	if (!meetingState.isChatOpen.value) {
		toggleChat();
	}
};

const syncFullscreenState = () => {
	isFullscreen.value = !!document.fullscreenElement;
};

const toggleFullscreen = async () => {
	try {
		if (!document.fullscreenElement) {
			const targetElement = document.body;

			if (targetElement?.requestFullscreen) {
				await targetElement.requestFullscreen();
			}
			return;
		}

		if (document.exitFullscreen) {
			await document.exitFullscreen();
		}
	} catch (error) {
		console.error("Failed to toggle fullscreen:", error);
	} finally {
		syncFullscreenState();
	}
};

const setSinkIdOnVideoElements = async (sinkId) => {
	// Set speaker output on all video elements
	const videoElements = document.querySelectorAll("video");

	if (videoElements.length === 0) {
		console.warn("No video elements found yet");
	}

	const promises = [];
	for (const videoEl of videoElements) {
		const promise = videoEl.setSinkId(sinkId).catch((error) => {
			console.error("Failed to set speaker for video element:", error);
		});
		promises.push(promise);
	}

	if (sfuManager.value?.videoManager) {
		const audioElements = sfuManager.value.videoManager.audioElements;

		for (const [participantId, audioElement] of audioElements) {
			const promise = audioElement.setSinkId(sinkId).catch((error) => {
				console.warn(
					`Failed to set speaker for audio element ${participantId}:`,
					error,
				);
			});
			promises.push(promise);
		}
	}

	await Promise.all(promises);
};

const handleDeviceChanged = async (event) => {
	if (event.type === "speaker") {
		await applySpeakerDevice();
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

			// Use selected devices unless this event overrides a specific one
			const cameraDeviceId =
				event.type === "camera" ? event.deviceId : selectedCameraId.value;
			const micDeviceId =
				event.type === "microphone" ? event.deviceId : selectedMicId.value;

			const { stream: newStream } = await acquireUserMedia(
				meetingState.isCameraOn.value,
				meetingState.isMicOn.value,
				{ cameraDeviceId, micDeviceId },
			);
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
			console.error("Failed to update media with new device:", error);
		}
	}
};

// Lifecycle
onMounted(async () => {
	window.addEventListener("keydown", handleKeyDown);
	window.addEventListener("keyup", handleKeyUp);
	document.addEventListener("fullscreenchange", syncFullscreenState);
	syncFullscreenState();

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

	// Check meeting access for unauthenticated users
	if (!session.isLoggedIn) {
		try {
			const accessData = await frappeRequest({
				url: "meet.api.meeting.check_meeting_access",
				params: {
					meeting_id: meetingId.value,
				},
			});

			if (!accessData.allow_guest) {
				router.push({
					name: "Login",
					query: { next: `/${meetingId.value}` },
				});
				return;
			}
		} catch (error) {
			console.error("Failed to check meeting access:", error);
			return;
		}
	}

	setupChatEvents(chatNotificationQueue.value);
	setupReactionEvents();
	setupRaiseHandEvents();

	// Check authentication and handle guest sessions
	if (!session.isLoggedIn) {
		await initializeCamera();
		if (selectedSpeakerId.value) {
			await applySpeakerDevice();
		}
		meetingState.isInPreview.value = true;
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
		await applySpeakerDevice();
	}

	// Auto-join if just created
	const wasJustCreated = route.query.created === "true";
	if (wasJustCreated) {
		await joinMeetingFromPreview();
	}
});

onUnmounted(() => {
	window.removeEventListener("keydown", handleKeyDown);
	window.removeEventListener("keyup", handleKeyUp);
	document.removeEventListener("fullscreenchange", syncFullscreenState);

	// Cleanup will be handled by the meeting logic composable
});

// Watch for localVideo element and localStream connection
// Check the data attribute to avoid unnecessary updates when ref callback already handled it
watch(
	[() => meetingState.localVideo, () => meetingState.localStream],
	async ([videoElement, stream]) => {
		if (videoElement && stream) {
			try {
				// only update srcObject if the source stream ID has changed
				// to prevent flashing when re-rendering
				const currentStreamId = stream.id;
				const trackedStreamId = videoElement.dataset.sourceStreamId;

				if (trackedStreamId !== currentStreamId) {
					const videoTracks = stream.getVideoTracks();
					if (videoTracks.length > 0) {
						videoElement.srcObject = new MediaStream(videoTracks);
					} else {
						videoElement.srcObject = stream;
					}
					videoElement.dataset.sourceStreamId = currentStreamId;
					videoElement.muted = true;
					await videoElement.play();
				}

				if (
					selectedSpeakerId.value &&
					typeof videoElement.setSinkId === "function"
				) {
					try {
						await videoElement.setSinkId(selectedSpeakerId.value);
					} catch (error) {
						console.warn("Could not set speaker for local video:", error);
					}
				}
			} catch (error) {
				console.warn("Could not play local video:", error);
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

// this is to avoid showing notifications for existing lobby users
// when the host joins the meeting
watch(
	() => meetingState.lobbyUsers?.value,
	(newUsers, oldUsers) => {
		if (isCurrentUserHost.value) {
			const newUserIds = new Set((newUsers || []).map((u) => u.userId));
			const oldUserIds = new Set((oldUsers || []).map((u) => u.userId));
			for (const userId of oldUserIds) {
				if (!newUserIds.has(userId)) {
					notifiedLobbyUsers.value.add(userId);
				}
			}
		}
	},
	{ immediate: true },
);
</script>
