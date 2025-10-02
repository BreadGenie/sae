import { computed, ref } from "vue";
import { getInitials } from "../utils/text";

let meetingStateInstance = null;

/**
 * Composable for managing meeting state and user interactions
 */
export function useMeetingState() {
	if (meetingStateInstance) {
		return meetingStateInstance;
	}

	// Connection states
	const isConnecting = ref(false);
	const connectionError = ref(null);
	const isInPreview = ref(true);
	const isSetupComplete = ref(false);

	// Media states
	const isMicOn = ref(false);
	const isCameraOn = ref(false);
	const isScreenSharing = ref(false);
	const localStream = ref(null);

	// Participants
	const currentUser = ref({});
	const participants = ref({});
	const remoteVideos = ref({});

	// Waiting room states
	const isWaitingForApproval = ref(false);
	const isJoinRequestRejected = ref(false);
	const waitingUsers = ref([]);
	const loadingUsers = ref([]);
	const isCreator = ref(false);

	// Chat states
	const isChatOpen = ref(false);
	const chatMessages = ref([]);
	const hasUnreadMessages = ref(false);

	// Screen sharing states
	const screenShareStream = ref(null);
	const activeScreenShareConsumers = ref([]);
	const localScreenShareStartedAt = ref(0);
	const screenShareStreams = ref({});

	const userInitials = computed(() => {
		const name =
			currentUser.value?.full_name ?? currentUser.value?.name ?? "You";
		return getInitials(name);
	});

	const userAvatar = computed(() => currentUser.value?.avatar || "");

	// Display logic for screen shares
	const displayScreenShares = computed(() => {
		let latest = null;

		for (const share of activeScreenShareConsumers.value) {
			if (!latest || (share.startedAt || 0) > (latest.startedAt || 0)) {
				latest = share;
			}
		}

		if (isScreenSharing.value && currentUser.value?.user_id) {
			const localEntry = {
				participantId: currentUser.value.user_id,
				consumerId: "local-screen",
				local: true,
				startedAt: localScreenShareStartedAt.value || 0,
			};
			if (!latest || localEntry.startedAt >= (latest.startedAt || 0)) {
				latest = localEntry;
			}
		}

		return latest ? [latest] : [];
	});

	const resetConnectionState = () => {
		connectionError.value = null;
		isConnecting.value = false;
		isInPreview.value = true;
		isSetupComplete.value = false;
		participants.value = {};
		remoteVideos.value = {};
		isChatOpen.value = false;
		chatMessages.value = [];
		hasUnreadMessages.value = false;
		isScreenSharing.value = false;
		screenShareStream.value = null;
		activeScreenShareConsumers.value = [];
		localScreenShareStartedAt.value = 0;
		screenShareStreams.value = {};
	};

	const setMediaState = (mic, camera) => {
		isMicOn.value = mic;
		isCameraOn.value = camera;
	};

	const addParticipant = (participant) => {
		// Skip adding current/local user to the remote participants map
		const selfId = currentUser.value?.user_id;
		if (selfId && participant?.user_id === selfId) {
			return;
		}
		participants.value[participant.user_id] = participant;
	};

	const removeParticipant = (participantId) => {
		delete participants.value[participantId];

		const videoEl = remoteVideos.value[participantId];
		if (videoEl?.srcObject) {
			for (const track of videoEl.srcObject.getTracks()) {
				track.stop();
			}
			videoEl.srcObject = null;
		}
		delete remoteVideos.value[participantId];
	};

	const updateParticipant = (participantId, updates) => {
		const participant = participants.value[participantId];
		if (participant) {
			participants.value[participantId] = { ...participant, ...updates };
		}
	};

	const getParticipantName = (participantId) => {
		const participant = participants.value[participantId];
		return participant?.user_name || participantId;
	};

	const stateObject = {
		isConnecting,
		connectionError,
		isInPreview,
		isSetupComplete,
		isMicOn,
		isCameraOn,
		isScreenSharing,
		localStream,
		currentUser,
		participants,
		remoteVideos,
		isWaitingForApproval,
		isJoinRequestRejected,
		waitingUsers,
		loadingUsers,
		isCreator,
		isChatOpen,
		chatMessages,
		hasUnreadMessages,
		screenShareStream,
		activeScreenShareConsumers,
		localScreenShareStartedAt,
		screenShareStreams,
		userInitials,
		userAvatar,
		displayScreenShares,
		resetConnectionState,
		setMediaState,
		addParticipant,
		removeParticipant,
		updateParticipant,
		getParticipantName,
	};

	meetingStateInstance = stateObject;
	return stateObject;
}

export function resetMeetingState() {
	meetingStateInstance = null;
}
