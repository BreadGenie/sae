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
				<p class="text-lg mb-4">{{ connectionState.connectionError }}</p>
				<Button @click="resetToPreview" variant="outline" theme="red">Try Again</Button>
			</div>
		</div>

		<!-- Preview mode -->
		<MeetingPreview
			v-else-if="showPreview"
			:meetingId="meetingId"
			@toggle-microphone="mediaControls.toggleMicrophone()"
			@toggle-camera="mediaControls.toggleCamera()"
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
							:isChatOpen="chatStore.isChatOpen.value"
							:isPeopleOpen="isPeopleOpen"
							:hasUnread="chatStore.hasUnreadMessages.value"
							:lobbyUserCount="lobbyStore.lobbyUsers?.value?.length || 0"
							:isMicOn="mediaState.isMicOn.value"
							:isCameraOn="mediaState.isCameraOn.value"
							:isScreenSharing="mediaState.isScreenSharing.value"
							:isFullscreen="isFullscreen"
							:isHandRaised="isHandRaised"
							:isReactionPickerOpen="isReactionPickerOpen"
							@update:isReactionPickerOpen="isReactionPickerOpen = $event"
							:meetingId="meetingId"
							:meetingTitle="meetingTitle"
							:currentUser="currentUser.currentUser.value"
							:cameraPermissionGranted="mediaState.cameraPermissionGranted.value"
							:microphonePermissionGranted="mediaState.microphonePermissionGranted.value"
							@toggle-chat="toggleChat"
							@toggle-people="togglePeople"
							@toggle-reactions="toggleReactions($event)"
							@toggle-microphone="mediaControls.toggleMicrophone()"
							@toggle-camera="mediaControls.toggleCamera()"
							@toggle-screen-share="mediaControls.toggleScreenShare()"
							@toggle-fullscreen="toggleFullscreen"
							@toggle-raise-hand="raiseHand.toggleRaiseHand()"
							@report-problem="handleReportProblem"
							@end-call="sfuConnection.endCall()"
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
								:messages="chatStore.chatMessages.value"
								:user-id="(currentUser.currentUser.value as Record<string, unknown>)?.user_id as string || ''"
								:user-name="
									((currentUser.currentUser.value as Record<string, unknown>)?.full_name as string) ||
									((currentUser.currentUser.value as Record<string, unknown>)?.name as string) ||
									'You'
								"
								@close="toggleChat"
								@send="chat.onSendChat"
							/>

							<!-- People Panel -->
							<PeoplePanel
								v-if="activePanel === 'people'"
								:open="true"
								:currentUser="currentUser.currentUser.value"
								:participants="participantsForPeoplePanel"
								:isMicOn="mediaState.isMicOn.value"
								:isCameraOn="mediaState.isCameraOn.value"
								:creatorUserId="meetingOwner"
								:coHosts="meetingCoHosts"
								:lobbyUsers="lobbyStore.lobbyUsers.value"
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
			@approve-user="lobby.approveUser"
			@reject-user="lobby.rejectUser"
		/>
	</div>
</template>

<script setup lang="ts">
import { Button, frappeRequest, toast } from "frappe-ui";
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
import { useBackgroundEffects } from "../composables/useBackgroundEffects";
import { useChat } from "../composables/useChat";
import { useChatStore } from "../composables/useChatStore";
import { useConnectionState } from "../composables/useConnectionState";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useGridLayout } from "../composables/useGridLayout";
import { useKeyboardShortcuts } from "../composables/useKeyboardShortcuts";
import { useLobby } from "../composables/useLobby";
import { useLobbyStore } from "../composables/useLobbyStore";
import { useMediaControls } from "../composables/useMediaControls";
import { useMediaState } from "../composables/useMediaState";
import { provideMeetingContext } from "../composables/useMeetingContext";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import { useNoiseCancellation } from "../composables/useNoiseCancellation";
import { useParticipantStore } from "../composables/useParticipantStore";
import { useRaiseHand } from "../composables/useRaiseHand";
import { useRaiseHandStore } from "../composables/useRaiseHandStore";
import { useReactionStore } from "../composables/useReactionStore";
import { useReactions } from "../composables/useReactions";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
import { useSFUConnection } from "../composables/useSFUConnection";
import {
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
} from "../data/mediaPreferences";
import { session } from "../data/session";
import { useSocket } from "../socket.js";
import type { Participant } from "../types";
import { openProblemReportEmail } from "../utils/diagnostics/problemReport";
import { deviceManager } from "../utils/media/DeviceManager";
import { getSFUClient } from "../utils/sfu-client";

// Router
const route = useRoute();
const router = useRouter();
const meetingId = computed(() => route.params.meetingId as string);

// --- Stores (singletons) ---
const connectionState = useConnectionState();
const currentUser = useCurrentUser();
const mediaState = useMediaState();
const participantStore = useParticipantStore();
const chatStore = useChatStore();
const lobbyStore = useLobbyStore();
const reactionStore = useReactionStore();
const raiseHandStore = useRaiseHandStore();
const gridLayout = useGridLayout(mediaState);

// --- Lobby notification tracking ---
const notifiedLobbyUsers = ref(new Set<string>());

// --- Meeting doc ---
const {
	getMeetingDoc,
	meetingTitle,
	meetingOwner,
	isCurrentUserHost,
	meetingCoHosts,
} = useMeetingDoc();
const meetingDoc = getMeetingDoc(meetingId.value);

// --- Background effects & noise cancellation ---
const backgroundEffects = useBackgroundEffects();
const noiseCancellation = useNoiseCancellation();

// --- Lobby notification conversion ---
const lobbyUsersForNotifications = computed(() => {
	return lobbyStore.lobbyUsers.value
		.filter((user) => !notifiedLobbyUsers.value.has(user.userId))
		.map((user) => ({
			user_id: user.userId,
			user_name: user.name,
			user_image: user.avatar,
		}));
});

// --- Guest session ---
const isGuestSession = computed(
	() =>
		!session.isLoggedIn &&
		(!!connectionState.guestAuthToken.value ||
			lobbyStore.isWaitingForApproval.value),
);

// --- SFU Connection ---
const sfuConnection = useSFUConnection({
	connectionState,
	currentUser,
	mediaState,
	participantStore,
	lobbyStore,
	gridLayout,
	meetingId: meetingId.value,
	notifiedLobbyUsers,
	onHostMutedYou: () => {
		if (mediaState.isMicOn.value) {
			mediaControls.toggleMicrophone();
		}
	},
	onHostKickedYou: () => sfuConnection.endCall(),
	onScreenShareStarted: (data: Record<string, unknown>) => {
		const pid = (data as Record<string, unknown>).participantId as string;
		if (!pid) return;
		const prev = mediaState.activeScreenShareConsumers.value || [];
		const filtered = prev.filter((s) => s.participantId !== pid);
		mediaState.activeScreenShareConsumers.value = [
			...filtered,
			{
				participantId: pid,
				consumerId:
					((
						(data as Record<string, unknown>).consumer as Record<
							string,
							unknown
						>
					)?.id as string) || "remote-screen",
				startedAt:
					((data as Record<string, unknown>).startedAt as number) || Date.now(),
			},
		];
		if ((data as Record<string, unknown>).stream instanceof MediaStream) {
			try {
				const store = mediaState.screenShareStreams?.value || {};
				store[pid] = (data as Record<string, unknown>).stream as MediaStream;
				mediaState.screenShareStreams.value = store;
			} catch (err) {
				console.warn("Failed to store screen share stream:", err);
			}
		}
	},
	onScreenShareStopped: (data: Record<string, unknown>) => {
		const pid = (data as Record<string, unknown>).participantId as string;
		const list = mediaState.activeScreenShareConsumers.value || [];
		mediaState.activeScreenShareConsumers.value = list.filter(
			(share) => share.participantId !== pid,
		);
		const store = mediaState.screenShareStreams?.value || {};
		if (pid && store[pid]) {
			const stream = store[pid];
			const tracks = (stream as MediaStream)?.getTracks?.();
			if (tracks) {
				for (const t of tracks) {
					t.stop();
				}
			}
			delete store[pid];
			mediaState.screenShareStreams.value = store;
		}
	},
	onActiveSpeakerChanged: (participantIds: string[]) => {
		participantStore.activeSpeakerIds.value = participantIds;
	},
});

// --- Media Controls ---
const mediaControls = useMediaControls({
	mediaState,
	connectionState,
	raiseHandStore,
	currentUser,
	sfuManager: sfuConnection.sfuManager,
	deviceManager,
	backgroundEffects,
	noiseCancellation,
	toast,
	mediaPreferences: {
		micEnabled: ref(false),
		cameraEnabled: ref(false),
		selectedCameraId,
		selectedMicId,
		selectedSpeakerId,
		pushToTalkEnabled: ref(false),
		noiseCancellationEnabled: ref(false),
		setMicEnabled: (_v: boolean) => {
			/* handled via mediaState */
		},
		setCameraEnabled: (_v: boolean) => {
			/* handled via mediaState */
		},
		setSelectedCameraId: () => {},
		setSelectedMicId: () => {},
		setSelectedSpeakerId: () => {},
	},
});

// --- Chat ---
const chat = useChat({
	chatStore,
	currentUser,
});

// --- Reactions ---
const reactions = useReactions({
	reactionStore,
	currentUser,
});

// --- Raise Hand ---
const raiseHand = useRaiseHand({
	raiseHandStore,
	currentUser,
});

// --- Lobby ---
const lobby = useLobby({
	lobbyStore,
	meetingId: meetingId.value as string,
});

// --- Keyboard Shortcuts ---
const keyboardShortcuts = useKeyboardShortcuts({
	mediaControls: {
		toggleMicrophone: () => mediaControls.toggleMicrophone(),
		toggleCamera: () => mediaControls.toggleCamera(),
	},
	mediaState,
});

// --- Provide meeting context for child components ---
provideMeetingContext({
	mediaState,
	participantStore,
	currentUser,
	chatStore,
	gridLayout,
	sfuManager: sfuConnection.sfuManager,
	processedStream: mediaState.processedStream,
	isInMeeting: computed(() => true),
	onBackgroundEffectsChanged: mediaControls.applyBackgroundEffectsToLocalStream,
});

// Provide backward-compatible strings for legacy inject calls
provide("setLocalVideoRef", mediaControls.setLocalVideoRef);
provide("setRemoteVideoRef", mediaControls.setRemoteVideoRef);
provide("setScreenShareVideoRef", mediaControls.setScreenShareVideoRef);
provide("getParticipantName", participantStore.getParticipantName);
provide("meetingState", {
	...connectionState,
	...mediaState,
	...participantStore,
	...chatStore,
	...lobbyStore,
	...reactionStore,
	...raiseHandStore,
	...gridLayout,
	currentUser: currentUser.currentUser,
	userInitials: currentUser.userInitials,
	userAvatar: currentUser.userAvatar,
});
provide("meetingId", meetingId.value);
provide("sfuManager", sfuConnection.sfuManager);
provide("socket", useSocket());
provide("isCurrentUserHost", isCurrentUserHost);
provide("hostControls", {
	muteParticipant: (...args: unknown[]) =>
		handleMuteParticipant(args[0] as string),
	kickParticipant: (...args: unknown[]) =>
		handleKickParticipant(args[0] as string, args[1] as boolean),
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

// --- Computed properties ---
const isConnecting = computed(() => connectionState.isConnecting.value);
const hasConnectionError = computed(
	() => !!connectionState.connectionError.value,
);
const isInLobby = computed(() => lobbyStore.isInLobby?.value || false);
const isWaitingForApproval = computed(
	() => lobbyStore.isWaitingForApproval?.value || false,
);
const isRejected = computed(
	() => lobbyStore.isJoinRequestRejected?.value || false,
);
const showPreview = computed(() => {
	const isUnauthenticatedGuest = !session.isLoggedIn && !isGuestSession.value;
	if (isUnauthenticatedGuest) {
		return true;
	}

	if (isGuestSession.value) {
		return false;
	}
	if (lobbyStore.isInLobby?.value) {
		return false;
	}
	if (lobbyStore.isWaitingForApproval.value) {
		return false;
	}
	const inPreview = connectionState.isInPreview.value;
	const joinRequestRejected = lobbyStore.isJoinRequestRejected.value;
	return inPreview || joinRequestRejected;
});

const isPeopleOpen = ref(false);

const activePanel = computed(() => {
	if (chatStore.isChatOpen.value) return "chat";
	if (isPeopleOpen.value) return "people";
	return null;
});

const participantsForPeoplePanel = computed<Record<string, Participant>>(
	() => participantStore.participants.value as Record<string, Participant>,
);

const { windowWidth } = useResponsiveGrid();
const isMobile = computed(() => windowWidth.value < 768);

const panelWidth = computed(() => {
	if (!activePanel.value) return "0rem";
	if (isMobile.value) return "0rem";
	return "24rem";
});

const isHandRaised = computed(() => {
	const currentUserId = (
		currentUser.currentUser.value as Record<string, unknown>
	)?.user_id as string;
	return currentUserId
		? !!raiseHandStore.raisedHands.value?.[currentUserId]
		: false;
});

// --- Refs ---
const chatNotificationQueue = ref<InstanceType<
	typeof ChatNotificationQueue
> | null>(null);
const isReactionPickerOpen = ref(false);
const isFullscreen = ref(false);

// --- Methods ---
const resetToPreview = () => {
	connectionState.connectionError.value = null;
	connectionState.isConnecting.value = false;
	connectionState.isInPreview.value = true;
};

const joinMeetingFromPreview = async () => {
	await sfuConnection.joinMeetingRoom();
};

const handleGuestJoinComplete = async ({
	guestName,
	joinResult,
}: {
	guestName: string;
	joinResult: Record<string, unknown>;
}) => {
	const guestId =
		(joinResult?.guest_id as string) ||
		(connectionState.guestId.value as string);
	const resolvedGuestName = guestName || localStorage.getItem("guest_name");

	if (guestId && resolvedGuestName) {
		currentUser.setCurrentUser({
			user_id: guestId,
			name: resolvedGuestName,
			full_name: resolvedGuestName,
			avatar: null,
			is_guest: true,
		});
	}

	await sfuConnection.handleGuestJoinResult(
		joinResult,
		resolvedGuestName || "",
	);
};

const leaveWaitingRoom = () => {
	lobbyStore.isWaitingForApproval.value = false;
	lobbyStore.isJoinRequestRejected.value = false;
	router.push({ name: "Home" });
};

const leaveLobby = async () => {
	const sfuClient = getSFUClient();
	if (sfuClient?.isInLobby?.()) {
		await sfuClient.leaveLobby();
		sfuClient.disconnect();
	}

	lobbyStore.isInLobby.value = false;
	lobbyStore.isWaitingForApproval.value = false;
	lobbyStore.lobbyParticipantCount.value = 0;

	router.push({ name: "Home" });
};

const goHome = () => {
	lobbyStore.isJoinRequestRejected.value = false;
	lobbyStore.isInLobby.value = false;
	router.push({ name: "Home" });
};

const tryJoinAgain = async () => {
	lobbyStore.isJoinRequestRejected.value = false;

	if (isGuestSession.value) {
		connectionState.isInPreview.value = true;
		return;
	}

	await sfuConnection.joinMeetingRoom();
};

const toggleReactions = (payload: string) => {
	reactions.onSendReaction(payload);
	isReactionPickerOpen.value = false;
};

const toggleChat = () => {
	chatStore.isChatOpen.value = !chatStore.isChatOpen.value;
	if (chatStore.isChatOpen.value) {
		chatStore.hasUnreadMessages.value = false;
		isPeopleOpen.value = false;
	}
};

const togglePeople = () => {
	isPeopleOpen.value = !isPeopleOpen.value;
	if (isPeopleOpen.value) {
		chatStore.isChatOpen.value = false;
	}
};

const handleMuteParticipant = async (participantId: string) => {
	try {
		if (sfuConnection.sfuManager.value?.sfuClient) {
			sfuConnection.sfuManager.value.sfuClient.sendEvent("host_control", {
				action: "mute_participant",
				targetParticipantId: participantId,
			});
		} else {
			console.error("SFU client not available");
		}
	} catch (error) {
		console.error("Failed to mute participant:", error);
	}
};

const handleKickParticipant = async (participantId: string, ban = false) => {
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

		if (sfuConnection.sfuManager.value?.sfuClient) {
			sfuConnection.sfuManager.value.sfuClient.sendEvent("host_control", {
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

const handleLowerHand = async (participantId: string) => {
	try {
		if (sfuConnection.sfuManager.value?.sfuClient) {
			sfuConnection.sfuManager.value.sfuClient.sendEvent("host_control", {
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

const handlePromoteToCohost = async (participantId: string) => {
	try {
		const response = await frappeRequest({
			url: "meet.api.meeting.promote_to_cohost",
			params: {
				meeting_id: route.params.meetingId,
				user_id: participantId,
			},
		});

		if ((response as Record<string, unknown>)?.meeting_id) {
			toast.success("User promoted to co-host");
			await meetingDoc.reload();
		}
	} catch (error) {
		console.error("Failed to promote participant to co-host:", error);
		toast.error("Failed to promote user to co-host");
	}
};

const handleApproveLobbyUser = async (participantId: string) => {
	try {
		await lobby.approveUser(participantId);
		notifiedLobbyUsers.value.add(participantId);
	} catch (error) {
		console.error("Failed to approve lobby user:", error);
	}
};

const handleApproveAllLobbyUsers = async (participantIds: string[]) => {
	try {
		await lobby.approveAllUsers();
		for (const userId of participantIds) {
			notifiedLobbyUsers.value.add(userId);
		}
	} catch (error) {
		console.error("Failed to approve all lobby users:", error);
	}
};

const handleRejectLobbyUser = async (participantId: string) => {
	try {
		await lobby.rejectUser(participantId);
		notifiedLobbyUsers.value.add(participantId);
	} catch (error) {
		console.error("Failed to reject lobby user:", error);
	}
};

const handleNotificationClick = () => {
	if (!chatStore.isChatOpen.value) {
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

const setSinkIdOnVideoElements = async (sinkId: string) => {
	const videoElements = document.querySelectorAll("video");
	const promises = [];
	for (const videoEl of videoElements) {
		const promise = (videoEl as HTMLVideoElement)
			.setSinkId(sinkId)
			.catch((error: Error) => {
				console.error("Failed to set speaker for video element:", error);
			});
		promises.push(promise);
	}

	if (sfuConnection.sfuManager.value?.videoManager) {
		const audioElements =
			sfuConnection.sfuManager.value.videoManager.audioElements;
		for (const [, audioElement] of audioElements) {
			const promise = audioElement.setSinkId(sinkId).catch((error: Error) => {
				console.warn("Failed to set speaker for audio element:", error);
			});
			promises.push(promise);
		}
	}

	await Promise.all(promises);
};

const handleReportProblem = async () => {
	await openProblemReportEmail({
		meetingId: String(meetingId.value || ""),
		networkQuality: connectionState.networkQuality?.value,
		localStream: mediaState.localStream.value,
		transportManager: sfuConnection.sfuManager.value?.transportManager || null,
	});
};

const handleDeviceChanged = async (event: Record<string, unknown>) => {
	if (event.type === "speaker") {
		await mediaControls.applySpeakerDevice();
		return;
	}

	if (mediaState.isCameraOn.value || mediaState.isMicOn.value) {
		try {
			const oldStream = mediaState.localStream.value;
			if (oldStream) {
				for (const track of oldStream.getTracks()) {
					track.stop();
				}
			}

			const cameraDeviceId =
				event.type === "camera"
					? (event.deviceId as string)
					: selectedCameraId.value;
			const micDeviceId =
				event.type === "microphone"
					? (event.deviceId as string)
					: selectedMicId.value;

			const { stream: newStream } = await mediaControls.acquireUserMedia(
				mediaState.isCameraOn.value,
				mediaState.isMicOn.value,
				{ cameraDeviceId, micDeviceId },
			);
			mediaState.localStream.value = newStream;

			if (mediaState.localVideo.value) {
				(mediaState.localVideo.value as HTMLVideoElement).srcObject = newStream;
			}

			if (sfuConnection.sfuManager.value?.mediaHandler) {
				const mh = sfuConnection.sfuManager.value.mediaHandler;

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

// --- Lifecycle ---
onMounted(async () => {
	// Reset all stores
	connectionState.resetConnectionState();
	mediaState.resetMediaState();
	participantStore.resetParticipantStore();
	chatStore.resetChatStore();
	lobbyStore.resetLobbyStore();
	reactionStore.resetReactionStore();
	raiseHandStore.resetRaiseHandStore();
	gridLayout.resetGridLayout();
	currentUser.setCurrentUser({
		user_id: "",
		name: "",
		full_name: "",
		avatar: "",
	});

	window.addEventListener("keydown", keyboardShortcuts.handleKeyDown);
	window.addEventListener("keyup", keyboardShortcuts.handleKeyUp);
	document.addEventListener("fullscreenchange", syncFullscreenState);
	syncFullscreenState();

	// Check meeting access for unauthenticated users
	if (!session.isLoggedIn) {
		try {
			const accessData = await frappeRequest({
				url: "meet.api.meeting.check_meeting_access",
				params: {
					meeting_id: meetingId.value,
				},
			});

			if (!(accessData as Record<string, unknown>).allow_guest) {
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

	// Setup event handlers
	chat.setupChatEvents(chatNotificationQueue.value);
	reactions.setupReactionEvents();
	raiseHand.setupRaiseHandEvents();

	// Setup notification context watchers

	if (!session.isLoggedIn) {
		await mediaControls.initializeCamera();
		if (selectedSpeakerId.value) {
			await mediaControls.applySpeakerDevice();
		}
		connectionState.isInPreview.value = true;
		return;
	}

	// Setup current user
	currentUser.setCurrentUser({
		user_id: session.user?.sessionUser || "",
		name: session.user?.full_name || session.user?.sessionUser || "",
		full_name: session.user?.full_name || "",
		avatar: session.user?.avatar || "",
	});

	// Initialize camera
	await mediaControls.initializeCamera();

	if (selectedSpeakerId.value) {
		await mediaControls.applySpeakerDevice();
	}

	// Auto-join if just created
	const wasJustCreated = route.query.created === "true";
	if (wasJustCreated) {
		await joinMeetingFromPreview();
	}
});

onUnmounted(() => {
	window.removeEventListener("keydown", keyboardShortcuts.handleKeyDown);
	window.removeEventListener("keyup", keyboardShortcuts.handleKeyUp);
	document.removeEventListener("fullscreenchange", syncFullscreenState);
});

// Watch for localVideo element and localStream connection
watch(
	[() => mediaState.localVideo.value, () => mediaState.localStream.value],
	async ([videoElement, stream]) => {
		if (videoElement && stream) {
			try {
				const currentStreamId = stream.id;
				const trackedStreamId = (videoElement as HTMLElement).dataset
					?.sourceStreamId;

				if (trackedStreamId !== currentStreamId) {
					const videoTracks = stream.getVideoTracks();
					if (videoTracks.length > 0) {
						(videoElement as HTMLVideoElement).srcObject = new MediaStream(
							videoTracks,
						);
					} else {
						(videoElement as HTMLVideoElement).srcObject = stream;
					}
					(videoElement as HTMLElement).dataset.sourceStreamId =
						currentStreamId;
					(videoElement as HTMLVideoElement).muted = true;
					await (videoElement as HTMLVideoElement).play();
				}

				if (
					selectedSpeakerId.value &&
					typeof (videoElement as HTMLVideoElement).setSinkId === "function"
				) {
					try {
						await (videoElement as HTMLVideoElement).setSinkId(
							selectedSpeakerId.value,
						);
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

// Watch lobby users for notification tracking
watch(
	() => lobbyStore.lobbyUsers?.value,
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
