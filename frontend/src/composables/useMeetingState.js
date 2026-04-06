import { computed, ref } from "vue";
import { getInitials } from "../utils/text";

let meetingStateInstance = null;

/**
 * Composable for managing meeting state and user interactions
 */
export function useMeetingState() {
	if (meetingStateInstance) {
		if (!meetingStateInstance.cameraPermissionGranted) {
			meetingStateInstance.cameraPermissionGranted = ref(false);
		}
		if (!meetingStateInstance.microphonePermissionGranted) {
			meetingStateInstance.microphonePermissionGranted = ref(false);
		}
		return meetingStateInstance;
	}

	// Connection states
	const isConnecting = ref(false);
	const connectionError = ref(null);
	const isInPreview = ref(true);
	const isSetupComplete = ref(false);
	const codecStrategy = ref("svc");

	// Network quality states
	const networkQuality = ref("good");
	const connectionIssues = ref([]);

	// Media states
	const isMicOn = ref(false);
	const isCameraOn = ref(false);
	const isScreenSharing = ref(false);
	const localStream = ref(null);
	const cameraPermissionGranted = ref(false);
	const microphonePermissionGranted = ref(false);

	// Participants
	const currentUser = ref({});
	const participants = ref({});
	const remoteVideos = ref({});
	const activeSpeakerIds = ref([]);
	const stableSpeakerIds = ref([]);
	const speakerStartTimes = ref({});

	// Waiting room states
	const isWaitingForApproval = ref(false);
	const isJoinRequestRejected = ref(false);
	const waitingUsers = ref([]);
	const loadingUsers = ref([]);
	const isCreator = ref(false);

	const isInLobby = ref(false);
	const lobbyUsers = ref([]);
	const lobbyParticipantCount = ref(0);

	// Guest user states
	const guestSessionToken = ref(null);
	const guestId = ref(null);
	const guestAuthToken = ref(null);
	const guestSfuUrl = ref(null);
	const guestSfuPort = ref(null);

	// Chat states
	const isChatOpen = ref(false);
	const chatMessages = ref([]);
	const hasUnreadMessages = ref(false);

	// People panel states
	const isPeopleOpen = ref(false);

	// Reactions states
	const reactions = ref({});

	// Raised hands states
	const raisedHands = ref({});

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
		codecStrategy.value = "svc";
		networkQuality.value = "good";
		connectionIssues.value = [];
		participants.value = {};
		remoteVideos.value = {};
		isChatOpen.value = false;
		chatMessages.value = [];
		hasUnreadMessages.value = false;
		isPeopleOpen.value = false;
		reactions.value = {};
		isScreenSharing.value = false;
		screenShareStream.value = null;
		activeScreenShareConsumers.value = [];
		localScreenShareStartedAt.value = 0;
		screenShareStreams.value = {};
		isMicOn.value = false;
		isCameraOn.value = false;
		localStream.value = null;
		cameraPermissionGranted.value = false;
		microphonePermissionGranted.value = false;
		stableSpeakerIds.value = [];
		speakerStartTimes.value = {};
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
		codecStrategy,
		networkQuality,
		connectionIssues,
		isMicOn,
		isCameraOn,
		isScreenSharing,
		localStream,
		cameraPermissionGranted,
		microphonePermissionGranted,
		currentUser,
		participants,
		remoteVideos,
		activeSpeakerIds,
		stableSpeakerIds,
		speakerStartTimes,
		isWaitingForApproval,
		isJoinRequestRejected,
		waitingUsers,
		loadingUsers,
		isCreator,
		isInLobby,
		lobbyUsers,
		lobbyParticipantCount,
		guestSessionToken,
		guestId,
		guestAuthToken,
		guestSfuUrl,
		guestSfuPort,
		isChatOpen,
		chatMessages,
		hasUnreadMessages,
		isPeopleOpen,
		reactions,
		raisedHands,
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
