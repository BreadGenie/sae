import { createResource, frappeRequest, toast } from "frappe-ui";
import {
	defineAsyncComponent,
	h,
	onUnmounted,
	type Ref,
	shallowRef,
} from "vue";
import { useRouter } from "vue-router";
import { useSocket } from "../socket";
import audioNotificationManager from "../utils/audioNotifications";
import { getErrorMessage } from "../utils/error";
import {
	exportEd25519PublicKey,
	exportPublicKey,
	importEd25519PublicKey,
	setMeetingContext,
	setSenderSigningPub,
	wipeMeetingContext,
	x25519KeyPair,
} from "../utils/media/e2ee";
import { SocketIOSignalChannel } from "../utils/media/SignalChannel";
import { SFUClient } from "../utils/SFUClient";
import { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { useChatStore } from "./useChatStore";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import { useDeviceIdentity } from "./useDeviceIdentity";
import { useE2EEHandshake } from "./useE2EEHandshake";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";

interface WaitingRoomResponse {
	waiting_users: Array<{
		user_id: string;
		full_name?: string;
		user_image?: string;
		is_guest?: boolean;
	}>;
}

export interface SFUScreenShareData {
	participantId?: string;
	consumer?: { id: string };
	startedAt?: number;
	stream?: MediaStream;
}

interface SFUConnectionAPI {
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	joinMeetingRoom: () => Promise<void>;
	handleGuestJoinResult: (
		joinResult: Record<string, unknown>,
		guestName: string,
	) => Promise<void>;
	setupFrappeRealtimeEventListeners: () => void;
	endCall: () => Promise<void>;
	fetchExistingWaitingRoomUsers: () => Promise<void>;
}

export function useSFUConnection(deps: {
	connectionState: ConnectionState;
	currentUser: CurrentUser;
	mediaState: MediaState;
	participantStore: ParticipantStore;
	lobbyStore: LobbyStore;
	gridLayout: GridLayout;
	meetingId: string;
	notifiedLobbyUsers: Ref<Set<string>>;
	onHostMutedYou: () => void;
	onHostKickedYou: () => void;
	onScreenShareStarted: (data: SFUScreenShareData) => void;
	onScreenShareStopped: (data: SFUScreenShareData) => void;
	onActiveSpeakerChanged: (participantIds: string[]) => void;
}): SFUConnectionAPI {
	const {
		connectionState,
		currentUser,
		mediaState,
		participantStore,
		lobbyStore,
		meetingId,
		notifiedLobbyUsers,
		onHostMutedYou,
		onHostKickedYou,
		onScreenShareStarted,
		onScreenShareStopped,
		onActiveSpeakerChanged,
	} = deps;

	const router = useRouter();
	const socket = useSocket();

	const chatStore = useChatStore();

	const signalChannel = new SocketIOSignalChannel();
	const sfuClient = new SFUClient(signalChannel);
	const sfuManager = shallowRef<SFUMeetingManager | null>(null);

	const realtimeListenersSetup = shallowRef(false);
	const joiningInProgress = shallowRef(false);
	const hasShownE2EEKeyMismatchToast = shallowRef(false);
	const isCurrentTabHost = shallowRef(false);

	// E2EE handshake state.
	// hostX25519Priv / hostX25519Pub are populated when this tab is the host
	const pendingJoinerHellos: Array<{
		fromParticipantId: string;
		fromSenderId: number;
		x25519PublicKey: string;
		signingPublicKey: string;
	}> = [];
	// who enabled E2EE. joinerX25519Priv is populated for joiners and used to
	// open the host's envelope. meetingSecret is the meeting-shared secret
	// derived from the envelope exchange; null until the handshake completes.
	const hostX25519Priv = shallowRef<CryptoKey | null>(null);
	const hostX25519PubB64 = shallowRef<string | null>(null);
	const hostSigningKey = shallowRef<CryptoKey | null>(null);
	const hostSigningPubKey = shallowRef<CryptoKey | null>(null);
	const identitySigningPubB64 = shallowRef<string>("");
	const joinerX25519Priv = shallowRef<CryptoKey | null>(null);
	const joinerX25519PubB64 = shallowRef<string | null>(null);
	const joinerPubBySenderId = new Map<number, string>();
	const joinerSigningPubBySenderId = new Map<number, string>();
	const meetingSecret = shallowRef<Uint8Array<ArrayBuffer> | null>(null);
	const keyVersion = shallowRef<number | null>(null);
	const { openJoinerEnvelope, buildResponderEnvelope } = useE2EEHandshake();
	const { getIdentity: getDeviceIdentity } = useDeviceIdentity();
	const E2EE_KEY_HOLDER_TIMEOUT_MESSAGE =
		"The meeting host is not online to provide the E2EE key. Ask the host to stay online, or recreate the meeting.";

	const joinMeetingAPI = createResource({
		url: "meet.api.meeting.join_meeting",
		method: "POST",
		makeParams: () => ({ meeting_id: meetingId }),
	});

	const activeSpeakerTimeout = shallowRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	let stabilityCheckTimeout: ReturnType<typeof setTimeout> | null = null;

	const handleParticipantJoined = (participant: Record<string, unknown>) => {
		const participantName = participant?.user_name || participant?.user_id;
		const participantId = participant.participantId || participant?.user_id;
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (
			!participantId ||
			participantId === currentUserId ||
			participant?.user_id === currentUserId
		) {
			return;
		}

		participantStore.addParticipant(participant);

		audioNotificationManager.playJoinNotification(
			participant.participantId as string,
		);

		if (sfuManager.value?.initialSyncInProgress) {
			return;
		}

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast.create({
			message: `${participantName} joined the meeting`,
			icon: participant.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "rounded-full",
					})
				: h(LucideUserIcon, {
						class: "text-white",
					}),
			duration: 3,
		});
	};

	const handleParticipantLeft = ({
		participantId,
	}: {
		participantId: string;
	}) => {
		const participant = participantStore.participants[participantId] as
			| Record<string, unknown>
			| undefined;
		const participantName = participant?.user_name || participantId;

		participantStore.removeParticipant(participantId);

		if (participantId === currentUser.currentUser.value?.user_id) {
			return;
		}

		const LucideUserIcon = defineAsyncComponent(
			() => import("~icons/lucide/user"),
		);

		toast.create({
			message: `${participantName} left the meeting`,
			icon: participant?.avatar
				? h("img", {
						src: participant.avatar as string,
						class: "rounded-full",
					})
				: h(LucideUserIcon, {
						class: "text-white",
					}),
			duration: 3,
		});
	};

	const handleParticipantUpdated = (
		participantId: string,
		_participant: Record<string, unknown>,
		updates: Record<string, unknown>,
	) => {
		if (participantId) {
			participantStore.updateParticipant(participantId, updates || {});
		}
	};

	const createSFUEventHandlers = () => {
		return {
			onParticipantJoined: handleParticipantJoined,
			onParticipantLeft: handleParticipantLeft,
			onParticipantUpdated: handleParticipantUpdated,
			onScreenShareStarted: onScreenShareStarted,
			onScreenShareStopped: onScreenShareStopped,
			onActiveSpeakerChanged: (participantIds: string[]) => {
				if (activeSpeakerTimeout.value) {
					clearTimeout(activeSpeakerTimeout.value);
					activeSpeakerTimeout.value = null;
				}
				if (stabilityCheckTimeout) {
					clearTimeout(stabilityCheckTimeout);
					stabilityCheckTimeout = null;
				}

				onActiveSpeakerChanged(participantIds);

				const STABLE_THRESHOLD_MS = 1000;
				const DEMOTE_THRESHOLD_MS = 3000;

				const checkStability = () => {
					const now = Date.now();
					const currentSet = new Set(participantStore.activeSpeakerIds);
					const startTimes = {
						...participantStore.speakerStartTimes,
					} as Record<string, number>;
					const currentStable = new Set(
						participantStore.stableSpeakerIds || [],
					);

					let hasPendingCandidates = false;

					for (const id of Object.keys(startTimes)) {
						if (!currentSet.has(id)) {
							if (startTimes[id] > 0) {
								startTimes[id] = -now;
							} else if (now - Math.abs(startTimes[id]) > DEMOTE_THRESHOLD_MS) {
								delete startTimes[id];
								currentStable.delete(id);
							}
						} else if (startTimes[id] < 0) {
							startTimes[id] = now;
						}
					}

					for (const id of currentSet) {
						if (startTimes[id] === undefined) {
							startTimes[id] = now;
						}
					}

					for (const id of currentSet) {
						const startTime = startTimes[id];
						if (startTime > 0) {
							if (now - startTime >= STABLE_THRESHOLD_MS) {
								currentStable.add(id);
							} else {
								hasPendingCandidates = true;
							}
						}
					}

					participantStore.speakerStartTimes = startTimes;
					participantStore.stableSpeakerIds = Array.from(currentStable);

					if (hasPendingCandidates) {
						if (stabilityCheckTimeout) clearTimeout(stabilityCheckTimeout);
						stabilityCheckTimeout = setTimeout(checkStability, 200);
					} else {
						stabilityCheckTimeout = null;
					}
				};

				checkStability();

				if (participantIds.length > 0) {
					activeSpeakerTimeout.value = setTimeout(() => {
						participantStore.activeSpeakerIds = [];
						activeSpeakerTimeout.value = null;
					}, 1000);
				}
			},
			onHostMutedYou: onHostMutedYou,
			onHostKickedYou: (_data: unknown) => {
				toast.error("You have been removed from the meeting by the host");
				onHostKickedYou();
			},
		};
	};

	const setupSFUConnection = async (
		guestName: string | null = null,
		initialIsHost = false,
		initialIsCohost = false,
	) => {
		let isHost = initialIsHost;
		let isCohost = initialIsCohost;
		isCurrentTabHost.value = isHost;
		if (connectionState.isSetupComplete) {
			connectionState.isInPreview = false;
			connectionState.isConnecting = false;
			return;
		}

		try {
			const manager = new SFUMeetingManager(sfuClient);
			manager.initialize({
				meetingId,
				currentUser: currentUser.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});
			sfuManager.value = manager;

			// Register SFU signaling handlers before connect/join. E2EE joiners can
			// receive their host envelope immediately after sending their hello.
			setupFrappeRealtimeEventListeners();

			await manager.connect(connectionState.guestAuthToken);
			connectionState.codecStrategy = sfuClient.getCodecStrategy() || "svc";
			if (!guestName) {
				const effectiveIsHost = sfuClient.connectionDetails.isHost || isHost;
				const effectiveIsCohost =
					sfuClient.connectionDetails.isCohost || isCohost;
				isHost = effectiveIsHost;
				isCohost = effectiveIsCohost;
				isCurrentTabHost.value = isHost;
			}

			if (sfuClient.isE2EERequired()) {
				if (!sfuClient.isInsertableStreamsSupported()) {
					throw new Error(
						"This meeting requires E2EE, but your browser does not support encoded insertable streams.",
					);
				}
			}

			let userData: Record<string, unknown>;
			if (guestName) {
				userData = {
					name: guestName,
					userId: connectionState.guestId || "",
					avatar: null,
					is_guest: true,
					isHost: false,
				};
			} else {
				userData = {
					name:
						currentUser.currentUser.value?.full_name ||
						currentUser.currentUser.value?.name ||
						"You",
					userId: currentUser.currentUser.value?.user_id || "",
					avatar: currentUser.currentUser.value?.avatar || "",
					is_guest: false,
					isHost,
				};
			}

			await manager.joinRoom(userData, {
				audio_enabled: mediaState.isMicOn,
				video_enabled: mediaState.isCameraOn,
			});

			// If E2EE was already enabled when we joined, set up in-memory
			// identity before any media transport is created. Meeting
			// secrets are not persisted; joiners must complete fresh ECDH.
			if (sfuClient.isE2EERequired() && !meetingSecret.value) {
				const identity = await getDeviceIdentity();
				identitySigningPubB64.value = identity.signingPublicKey;
			}

			// If E2EE was already enabled when we joined, kick off the
			// joiner handshake now. The realtime `meeting:e2ee_enabled`
			// event won't reach us (it was broadcast before we joined),
			// so without this trigger we'd be sitting in the room with
			// `e2ee.enabled: true` in our join request but no
			// meeting_secret yet, and no transform would install.
			if (sfuClient.isE2EERequired() && !meetingSecret.value) {
				const hostPub = sfuClient.connectionDetails.e2eeHostPublicKey;
				const hostSigningPubB64 =
					sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
				const hostUserId = sfuClient.connectionDetails.e2eeHostUserId;
				const keyVersion = sfuClient.connectionDetails.e2eeKeyVersion ?? "";
				if (hostPub && (hostSigningPubB64 || hostUserId)) {
					void startHandshakeAsJoiner(hostPub, hostSigningPubB64, keyVersion);
					try {
						await waitForHandshakeComplete(10000);
					} catch (error) {
						throw new Error(E2EE_KEY_HOLDER_TIMEOUT_MESSAGE, {
							cause: error,
						});
					}
				} else {
					throw new Error("E2EE is required but host key metadata is missing");
				}
			}

			await manager.initializeDevice();
			await manager.createReceiveTransport();

			if (mediaState.localStream) {
				try {
					const videoTracks = mediaState.processedStream
						? mediaState.processedStream.getVideoTracks()
						: mediaState.localStream.getVideoTracks();

					const audioTracks = mediaState.localStream.getAudioTracks();

					const streamToPublish = new MediaStream([
						...videoTracks,
						...audioTracks,
					]);

					await manager.publishMedia(streamToPublish, {
						publishVideo: mediaState.isCameraOn,
						publishAudio: mediaState.isMicOn,
					});
				} catch (error) {
					console.warn(
						"Media publishing failed, continuing without media:",
						(error as Error).message,
					);
				}
			}

			await manager.setupExistingParticipants();

			connectionState.isSetupComplete = true;

			if (!guestName && (isHost || isCohost)) {
				fetchExistingWaitingRoomUsers();
			}
		} catch (error) {
			console.error("SFU setup failed:", error);
			throw error;
		}
	};

	const fetchExistingWaitingRoomUsers = async () => {
		try {
			const result = (await frappeRequest({
				url: "meet.api.meeting.get_waiting_room",
				params: { meeting_id: meetingId },
			})) as WaitingRoomResponse;

			if (result?.waiting_users) {
				const transformedUsers = result.waiting_users.map((user) => ({
					userId: user.user_id,
					name: user.full_name || user.user_id,
					avatar: user.user_image as string,
					isGuest: user.is_guest || false,
				}));

				lobbyStore.setLobbyUsers(transformedUsers);

				if (notifiedLobbyUsers.value) {
					for (const user of transformedUsers) {
						notifiedLobbyUsers.value.add(user.userId);
					}
				}
			}
		} catch (error) {
			console.error("Failed to fetch waiting room users:", error);
		}
	};

	const setupGuestApprovalListener = (guestName: string) => {
		const guestId = sessionStorage.getItem("guest_id");

		if (!guestId) {
			console.error("No guest_id found for realtime listener");
			return;
		}

		if (!socket) {
			console.error("Socket not available for guest approval listener");
			return;
		}

		socket.emit("guest_subscribe", guestId);

		socket.on("meet:guest_join_approved", handleGuestApproved);
		socket.on("meet:guest_join_rejected", handleGuestRejected);

		async function handleGuestApproved(data: Record<string, unknown>) {
			if (data.guest_id !== guestId || data.meeting_id !== meetingId) {
				return;
			}

			stopGuestApprovalListener();

			lobbyStore.isWaitingForApproval = false;

			try {
				const resolvedGuestName =
					guestName || sessionStorage.getItem("guest_name") || "Guest";
				const sessionToken =
					sessionStorage.getItem("guest_session_token") || "";
				if (!sessionToken) {
					console.error(
						"Guest session_token missing from sessionStorage; cannot fetch connection details",
					);
					connectionState.connectionError =
						"Session token missing. Please rejoin the meeting.";
					return;
				}
				const response = await frappeRequest({
					url: "meet.api.meeting.get_approved_guest_connection_details",
					params: {
						meeting_id: meetingId,
						guest_id: guestId,
						session_token: sessionToken,
					},
				});
				if (
					(response as Record<string, unknown>)?.status === "joined" &&
					(response as Record<string, unknown>).auth_token
				) {
					if (
						(response as Record<string, unknown>).host_only_chat !== undefined
					) {
						chatStore.hostOnlyChat = !!(response as Record<string, unknown>)
							.host_only_chat;
					}

					connectionState.guestAuthToken = (response as Record<string, unknown>)
						.auth_token as string;
					connectionState.guestSfuUrl =
						((response as Record<string, unknown>).sfu_url as string) || null;
					connectionState.guestSfuPort =
						((response as Record<string, unknown>).sfu_port as string) || null;

					await setupSFUConnection(resolvedGuestName);

					connectionState.isInPreview = false;
					connectionState.isConnecting = false;
				} else {
					console.error(
						"Failed to get connection details after approval:",
						response,
					);
					connectionState.connectionError =
						"Failed to get authorization token after approval";
				}
			} catch (error) {
				console.error(
					"Error fetching connection details after approval:",
					error,
				);
				connectionState.connectionError = "Failed to connect after approval";
			}
		}

		function handleGuestRejected(data: Record<string, unknown>) {
			if (
				(data as Record<string, unknown>).guest_id !== guestId ||
				(data as Record<string, unknown>).meeting_id !== meetingId
			) {
				return;
			}

			stopGuestApprovalListener();

			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const stopGuestApprovalListener = () => {
		if (!socket) return;

		const guestId = sessionStorage.getItem("guest_id");

		if (guestId) {
			socket.emit("guest_unsubscribe", guestId);
		}

		socket.off("meet:guest_join_approved");
		socket.off("meet:guest_join_rejected");
	};

	const handleMeetingJoinRequest = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			if (!data.user) {
				return;
			}

			const userData = {
				userId: data.user as string,
				name: (data.user_name || data.user) as string,
				avatar: data.user_image as string,
				requested_at: new Date().toISOString(),
			};

			lobbyStore.addLobbyUser(userData);

			audioNotificationManager.playJoinRequestNotification();
		}
	};

	const handleMeetingJoinApproved = async (data: Record<string, unknown>) => {
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isWaitingForApproval = false;

			try {
				const sfuResult = await frappeRequest({
					url: "meet.api.meeting.get_sfu_connection_details",
					params: {
						meeting_id: meetingId,
					},
				});

				if (sfuResult) {
					await setupSFUConnection(
						null,
						(sfuResult as Record<string, unknown>).is_host as boolean,
						(sfuResult as Record<string, unknown>).is_cohost as boolean,
					);
					connectionState.isInPreview = false;
				} else {
					console.error("Failed to get SFU connection:", sfuResult);
					lobbyStore.isJoinRequestRejected = true;
					toast.error("Failed to join meeting after approval");
				}
			} catch (error) {
				console.error("Error after approval:", error);
				connectionState.connectionError = getErrorMessage(error);
				toast.error("Failed to join meeting after approval");
			}
		}
	};

	const handleMeetingJoinRejected = (data: Record<string, unknown>) => {
		const currentUserId = currentUser.currentUser.value?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isJoinRequestRejected = true;
			lobbyStore.isWaitingForApproval = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const handleMeetingUserApproved = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user as string);
		}
	};

	const handleMeetingUserRejected = (data: Record<string, unknown>) => {
		if (data.meeting === meetingId) {
			lobbyStore.removeLobbyUser(data.user as string);
		}
	};

	let isReconfiguringForE2EE = false;

	const announceSigningKey = async () => {
		if (!joinerX25519Priv.value || !joinerX25519PubB64.value) {
			const kp = await x25519KeyPair();
			joinerX25519Priv.value = kp.privateKey;
			joinerX25519PubB64.value = await exportPublicKey(kp.publicKey);
		}
		const participantId = currentUser.currentUser.value?.user_id || "";
		const senderId = sfuClient.getOwnSenderId?.() ?? 0;
		const identity = await getDeviceIdentity();
		console.log("[E2EE] signing key hello sent", {
			fromParticipantId: participantId,
			fromSenderId: senderId,
		});
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: participantId,
			fromSenderId: senderId,
			x25519PublicKey: joinerX25519PubB64.value,
			signingPublicKey: identity.signingPublicKey,
		});
	};

	const startHandshakeAsJoiner = async (
		hostX25519PubB64Param: string,
		hostSigningPubB64: string,
		keyVersionString: string,
	) => {
		const kp = await x25519KeyPair();
		joinerX25519Priv.value = kp.privateKey;
		joinerX25519PubB64.value = await exportPublicKey(kp.publicKey);
		const versionNumber = parseKeyVersion(keyVersionString);
		keyVersion.value = versionNumber;
		hostX25519PubB64.value = hostX25519PubB64Param;
		hostSigningPubKey.value = hostSigningPubB64
			? await importEd25519PublicKey(hostSigningPubB64)
			: null;
		await announceSigningKey();
	};

	const handleHandshakeEnvelope = async (data: {
		fromParticipantId: string;
		fromSenderId: number;
		toParticipantId?: string;
		toSenderId?: number;
		envelope?: string;
		responderX25519Pub?: string;
		responderSigningPublicKey?: string;
	}) => {
		console.log("[E2EE] handleHandshakeEnvelope received", {
			fromParticipantId: data.fromParticipantId,
			toParticipantId: data.toParticipantId,
			ownParticipantId: currentUser.currentUser.value?.user_id,
			hasEnvelope: !!data.envelope,
			hasJoinerPriv: !!joinerX25519Priv.value,
			hasResponderPub: !!(data.responderX25519Pub || hostX25519PubB64.value),
			keyVersion: keyVersion.value,
		});
		if (!data.envelope) {
			return;
		}
		const responderPubB64 = data.responderX25519Pub || hostX25519PubB64.value;
		if (
			!joinerX25519Priv.value ||
			!responderPubB64 ||
			!hostX25519PubB64.value ||
			responderPubB64 !== hostX25519PubB64.value ||
			keyVersion.value == null
		) {
			return;
		}
		const ownParticipantId = currentUser.currentUser.value?.user_id || "";
		if (data.toParticipantId && data.toParticipantId !== ownParticipantId) {
			return;
		}
		if (!hostSigningPubKey.value) {
			return;
		}
		const kp: CryptoKeyPair = {
			privateKey: joinerX25519Priv.value,
			publicKey: null as unknown as CryptoKey,
		};
		let result: {
			meetingSecret: Uint8Array<ArrayBuffer>;
			responderSigningPub: Uint8Array<ArrayBuffer>;
		};
		try {
			result = await openJoinerEnvelope(
				kp,
				responderPubB64,
				hostSigningPubKey.value,
				data.envelope,
				{ meetingId, keyVersion: keyVersion.value },
			);
		} catch (err) {
			console.error("[E2EE] openJoinerEnvelope failed:", err);
			return;
		}
		const responderSenderId = data.fromSenderId;
		try {
			const pub = await importEd25519PublicKey(
				b64FromBytes(result.responderSigningPub),
			);
			setSenderSigningPub(responderSenderId, pub);
		} catch (err) {
			console.error("[E2EE] failed to import responder signing pub:", err);
			return;
		}
		meetingSecret.value = result.meetingSecret;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: result.meetingSecret,
					keyVersion: keyVersion.value,
					signingPrivateKey: (await getDeviceIdentity()).signingKeyPair
						.privateKey,
				},
			}),
		);
	};

	const handleJoinerHello = async (data: {
		fromParticipantId: string;
		fromSenderId: number;
		x25519PublicKey?: string;
		signingPublicKey?: string;
	}) => {
		console.log("[E2EE] handleJoinerHello received", {
			fromParticipantId: data.fromParticipantId,
			fromSenderId: data.fromSenderId,
			hasX25519Pub: !!data.x25519PublicKey,
			hasSigningPub: !!data.signingPublicKey,
			hasHostPriv: !!hostX25519Priv.value,
			hasMeetingSecret: !!meetingSecret.value,
			keyVersion: keyVersion.value,
		});
		const ownParticipantId = currentUser.currentUser.value?.user_id || "";
		if (data.fromParticipantId === ownParticipantId) {
			return;
		}
		if (!data.x25519PublicKey || !data.signingPublicKey) {
			return;
		}
		joinerPubBySenderId.set(data.fromSenderId, data.x25519PublicKey);
		joinerSigningPubBySenderId.set(data.fromSenderId, data.signingPublicKey);
		try {
			setSenderSigningPub(
				data.fromSenderId,
				await importEd25519PublicKey(data.signingPublicKey),
			);
		} catch (err) {
			console.error("[E2EE] failed to import joiner signing pub:", err);
			return;
		}
		if (!meetingSecret.value || keyVersion.value == null) {
			console.log(
				"[E2EE] handleJoinerHello: meeting secret not ready, queueing hello",
			);
			pendingJoinerHellos.push({
				fromParticipantId: data.fromParticipantId,
				fromSenderId: data.fromSenderId,
				x25519PublicKey: data.x25519PublicKey,
				signingPublicKey: data.signingPublicKey,
			});
			return;
		}
		if (!hostX25519Priv.value) {
			return;
		}

		const identity = await getDeviceIdentity();
		const responderSigningPriv = identity.signingKeyPair.privateKey;
		if (!identitySigningPubB64.value) {
			identitySigningPubB64.value = identity.signingPublicKey;
		}
		if (!identitySigningPubB64.value) {
			console.warn("[E2EE] handleJoinerHello: responder signing key missing");
			return;
		}

		const responderPriv = hostX25519Priv.value;
		const responderPubB64 = hostX25519PubB64.value ?? "";
		if (!responderPubB64) {
			console.log(
				"[E2EE] handleJoinerHello: host priv exists but pub not exported yet, returning",
			);
			return;
		}
		const responderX25519PubBytes = bytesFromB64(responderPubB64);
		const responderSigningPubBytes = bytesFromB64(identitySigningPubB64.value);

		const envelope = await buildResponderEnvelope(
			responderPriv,
			responderSigningPriv,
			data.x25519PublicKey,
			responderX25519PubBytes,
			responderSigningPubBytes,
			meetingSecret.value,
			{ meetingId, keyVersion: keyVersion.value },
		);
		const ownSenderId = sfuClient.getOwnSenderId?.() ?? 0;
		console.log("[E2EE] envelope sent", {
			fromParticipantId: ownParticipantId,
			toParticipantId: data.fromParticipantId,
			toSenderId: data.fromSenderId,
			isHost: !!hostX25519Priv.value,
		});
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: ownParticipantId,
			fromSenderId: ownSenderId,
			toParticipantId: data.fromParticipantId,
			toSenderId: data.fromSenderId,
			envelope,
			responderX25519Pub: responderPubB64,
			responderSigningPublicKey: identitySigningPubB64.value,
		});
	};

	const handleHandshakeMessage = (data: unknown) => {
		if (!data || typeof data !== "object") {
			return;
		}
		const msg = data as {
			fromParticipantId?: string;
			fromSenderId?: number;
			toParticipantId?: string;
			toSenderId?: number;
			x25519PublicKey?: string;
			envelope?: string;
			responderX25519Pub?: string;
		};
		console.log("[E2EE] handleHandshakeMessage received", {
			fromParticipantId: msg.fromParticipantId,
			toParticipantId: msg.toParticipantId,
			hasX25519Pub: !!msg.x25519PublicKey,
			hasEnvelope: !!msg.envelope,
			ownParticipantId: currentUser.currentUser.value?.user_id,
		});
		if (msg.envelope) {
			void handleHandshakeEnvelope(
				msg as Parameters<typeof handleHandshakeEnvelope>[0],
			);
		} else if (msg.x25519PublicKey) {
			void handleJoinerHello(msg as Parameters<typeof handleJoinerHello>[0]);
		}
	};

	const handleHostE2EEKeySet = async (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (detail?.hostX25519KeyPair && detail?.keyVersion) {
			hostX25519Priv.value = detail.hostX25519KeyPair.privateKey;
			hostX25519PubB64.value = null;
			keyVersion.value = parseKeyVersion(detail.keyVersion);

			const pubB64 = await exportPublicKey(detail.hostX25519KeyPair.publicKey);
			hostX25519PubB64.value = pubB64;
			if (detail?.hostSigningKeyPair) {
				hostSigningKey.value = detail.hostSigningKeyPair.privateKey;
				identitySigningPubB64.value = await exportEd25519PublicKey(
					detail.hostSigningKeyPair.publicKey,
				);
			}
			if (sfuClient) {
				sfuClient.setE2EERequired(true, {
					hostPublicKey: pubB64,
					hostSigningPublicKey: identitySigningPubB64.value ?? null,
					keyVersion: detail.keyVersion,
				});
			}

			await generateHostMeetingSecret();

			// The host's existing producers were created on a non-E2EE
			// transport. We must tear them down and re-create on a new
			// E2EE-enabled transport so the sender transforms are installed.
			if (isReconfiguringForE2EE) return;
			isReconfiguringForE2EE = true;

			try {
				if (!sfuClient?.isConnected?.()) return;

				const videoStreamForRepublish =
					mediaState.processedStream || mediaState.localStream;
				const audioStreamForRepublish = mediaState.localStream;

				await sfuClient.refreshToken();

				// refreshToken() reflects the server's last persisted E2EE state,
				// which can still be stale while the host is converting the
				// meeting mid-call. Re-assert the host's freshly-generated
				// state before re-joining so transport setup installs transforms.
				sfuClient.setE2EERequired(true, {
					hostPublicKey: pubB64,
					hostSigningPublicKey: identitySigningPubB64.value ?? null,
					keyVersion: detail.keyVersion,
				});

				const userData = {
					userId: currentUser.currentUser.value?.user_id || "",
					name:
						currentUser.currentUser.value?.full_name ||
						currentUser.currentUser.value?.name ||
						"",
					avatar: currentUser.currentUser.value?.avatar || null,
					is_guest: currentUser.currentUser.value?.is_guest || false,
				};
				await sfuClient.joinRoom(meetingId, userData, {
					audio_enabled: mediaState.isMicOn,
					video_enabled: mediaState.isCameraOn,
				});

				if (sfuManager.value) {
					await sfuManager.value.reconfigureForE2EE(
						videoStreamForRepublish,
						audioStreamForRepublish,
					);
				}
			} catch (error) {
				console.error("Failed to reconfigure host for E2EE:", error);
			} finally {
				isReconfiguringForE2EE = false;
			}
		}
	};

	async function generateHostMeetingSecret() {
		const ms = new Uint8Array(32);
		globalThis.crypto.getRandomValues(ms);
		meetingSecret.value = ms;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: ms,
					keyVersion: keyVersion.value,
					signingPrivateKey: (await getDeviceIdentity()).signingKeyPair
						.privateKey,
				},
			}),
		);
		flushPendingJoinerHellos();
	}

	function parseKeyVersion(_s: string): number {
		return 1;
	}

	function bytesFromB64(b64: string): Uint8Array<ArrayBuffer> {
		const binary = atob(b64);
		const buffer = new ArrayBuffer(binary.length);
		const bytes = new Uint8Array(buffer);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	function b64FromBytes(bytes: Uint8Array<ArrayBuffer>): string {
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	function flushPendingJoinerHellos() {
		if (!meetingSecret.value || keyVersion.value == null) return;
		const ownParticipantId = currentUser.currentUser.value?.user_id || "";
		const pending = pendingJoinerHellos.splice(0);
		for (const hello of pending) {
			if (hello.fromParticipantId === ownParticipantId) continue;
			void handleJoinerHello(hello);
		}
	}

	document.addEventListener("meet:e2ee-host-enabled", handleHostE2EEKeySet);

	const handleHandshakeComplete = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (!detail?.meetingSecret || detail?.keyVersion == null) {
			return;
		}
		if (detail.meetingId && detail.meetingId !== meetingId) {
			return;
		}
		void (async () => {
			const signingPrivateKey =
				detail.signingPrivateKey ??
				(await getDeviceIdentity()).signingKeyPair.privateKey;
			setMeetingContext(
				detail.meetingSecret as Uint8Array<ArrayBuffer>,
				Number(detail.keyVersion),
				signingPrivateKey,
			);
			flushPendingJoinerHellos();
		})();
	};
	document.addEventListener(
		"meet:e2ee-handshake-complete",
		handleHandshakeComplete,
	);

	const resyncHandshake = () => {
		meetingSecret.value?.fill(0);
		meetingSecret.value = null;
		wipeMeetingContext();
		joinerX25519Priv.value = null;
		joinerX25519PubB64.value = null;
		hostSigningPubKey.value = null;
		keyVersion.value = null;
		if (!hostX25519PubB64.value) return;
		if (!sfuManager.value || !sfuClient.connected) return;
		const hostSigningPubB64 =
			sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
		if (!hostSigningPubB64) return;
		void startHandshakeAsJoiner(
			hostX25519PubB64.value,
			hostSigningPubB64,
			sfuClient.connectionDetails.e2eeKeyVersion ?? "",
		);
	};

	const handleSFUReconnect = () => {
		if (isCurrentTabHost.value) return;
		if (!meetingSecret.value) return;
		resyncHandshake();
	};

	const handleE2EEResync = (event: Event) => {
		const detail = (
			event as CustomEvent<{
				senderId: number;
				generation: number;
			}>
		).detail;
		console.warn(
			`E2EE: resync requested for sender ${detail.senderId} (gen ${detail.generation})`,
		);
		resyncHandshake();
	};
	document.addEventListener("meet:e2ee-needs-key-resync", handleE2EEResync);

	const handleMeetingE2EEEnabled = async (data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_host_signing_public_key?: string;
		e2ee_key_version?: string;
	}) => {
		if (data.meeting_id !== meetingId) return;
		if (isCurrentTabHost.value) return;
		if (isReconfiguringForE2EE) return;

		// path: if the realtime payload carries the host's X25519 pubkey
		// and a key version, start the handshake. We MUST wait for it
		// to complete (meeting_secret received) before reconfiguring media,
		// otherwise we publish encrypted frames with no decryption key.
		if (data.e2ee_host_public_key && data.e2ee_key_version) {
			const hostSigningPubB64 = data.e2ee_host_signing_public_key ?? "";
			if (!hostSigningPubB64) {
				console.error(
					"[E2EE] meeting:e2ee_enabled missing host signing pubkey",
				);
				return;
			}
			try {
				await startHandshakeAsJoiner(
					data.e2ee_host_public_key,
					hostSigningPubB64,
					data.e2ee_key_version,
				);
				// Wait for the handshake to complete (envelope received and
				// decrypted). The handleHandshakeComplete listener fires
				// meet:e2ee-handshake-complete which calls setMeetingContext.
				await waitForHandshakeComplete(10000);
			} catch (err) {
				console.error("E2EE handshake (joiner) failed:", err);
				toast.error(E2EE_KEY_HOLDER_TIMEOUT_MESSAGE);
				return;
			}
		}

		// Update SFU client's view of the meeting's E2EE state from the
		// realtime payload. Without this, the re-joinRoom call below would
		// send e2ee.enabled=false because connectionDetails was populated
		// before the host enabled E2EE, and the SFU would reject the
		// join with "E2EE is required for this room".
		sfuClient?.setE2EERequired(Boolean(data.e2ee_host_public_key), {
			hostPublicKey: data.e2ee_host_public_key ?? null,
			hostSigningPublicKey: data.e2ee_host_signing_public_key ?? null,
			keyVersion: data.e2ee_key_version ?? null,
		});

		isReconfiguringForE2EE = true;

		try {
			if (!sfuClient?.isConnected?.()) return;

			const hadCamera = mediaState.isCameraOn;
			const hadMic = mediaState.isMicOn;

			// Keep the live streams around so reconfigureForE2EE can re-produce
			// their tracks on the new E2EE-enabled send transport in the same
			// call. Stopping the tracks here and re-acquiring later races with
			// the SFU producer_created/producer_closed events and leaves the
			// host with no producers attached to the encrypted transport.
			//
			// The video stream should be the processed (background-effects-
			// applied) one so remote participants keep seeing the host with
			// the same background effects that were applied before E2EE.
			// The audio stream must be the raw local stream — the processed
			// stream only contains the BG-rendered video track and has no
			// audio.
			const videoStreamForRepublish =
				mediaState.processedStream || mediaState.localStream;
			const audioStreamForRepublish = mediaState.localStream;

			await sfuClient.refreshToken();

			const userData = {
				userId: currentUser.currentUser.value?.user_id || "",
				name:
					currentUser.currentUser.value?.full_name ||
					currentUser.currentUser.value?.name ||
					"",
				avatar: currentUser.currentUser.value?.avatar || null,
				is_guest: currentUser.currentUser.value?.is_guest || false,
			};
			await sfuClient.joinRoom(meetingId, userData, {
				audio_enabled: mediaState.isMicOn,
				video_enabled: mediaState.isCameraOn,
			});

			if (sfuManager.value) {
				await sfuManager.value.reconfigureForE2EE(
					videoStreamForRepublish,
					audioStreamForRepublish,
				);
			}

			// Only request a fresh stream if we didn't have one to republish.
			if (!videoStreamForRepublish || !audioStreamForRepublish) {
				document.dispatchEvent(
					new CustomEvent("meet:e2ee-needs-media-republish", {
						detail: { hadCamera, hadMic },
					}),
				);
			}
		} catch (error) {
			console.error("Failed to reconfigure for E2EE:", error);
		} finally {
			isReconfiguringForE2EE = false;
		}
	};

	function waitForHandshakeComplete(timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (meetingSecret.value) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				reject(new Error("E2EE handshake timed out"));
			}, timeoutMs);
			const listener = () => {
				if (meetingSecret.value) {
					clearTimeout(timer);
					document.removeEventListener(
						"meet:e2ee-handshake-complete",
						listener,
					);
					resolve();
				}
			};
			document.addEventListener("meet:e2ee-handshake-complete", listener);
		});
	}

	const setupFrappeRealtimeEventListeners = () => {
		if (realtimeListenersSetup.value) {
			return;
		}

		if (!socket) {
			console.warn("Socket not available for realtime events");
			return;
		}

		socket.on("meeting_join_request", handleMeetingJoinRequest);
		socket.on("meeting_join_approved", handleMeetingJoinApproved);
		socket.on("meeting_join_rejected", handleMeetingJoinRejected);
		socket.on("meeting_user_approved", handleMeetingUserApproved);
		socket.on("meeting_user_rejected", handleMeetingUserRejected);
		socket.on("meeting:e2ee_enabled", handleMeetingE2EEEnabled);

		// Use sfuClient.on (not signalChannel.on) so the handler is stored
		// in sfuClient.eventHandlers and re-registered on the signalChannel
		// after connect(). signalChannel.on() silently no-ops when the
		// socket is not yet connected (which it isn't at this point).
		sfuClient.on("e2ee:handshake", handleHandshakeMessage);
		sfuClient.on("reconnect", handleSFUReconnect);

		realtimeListenersSetup.value = true;
	};

	const removeFrappeRealtimeEventListeners = () => {
		if (!socket) return;

		socket.off("meeting_join_request", handleMeetingJoinRequest);
		socket.off("meeting_join_approved", handleMeetingJoinApproved);
		socket.off("meeting_join_rejected", handleMeetingJoinRejected);
		socket.off("meeting_user_approved", handleMeetingUserApproved);
		socket.off("meeting_user_rejected", handleMeetingUserRejected);
		socket.off("meeting:e2ee_enabled", handleMeetingE2EEEnabled);

		sfuClient.off("e2ee:handshake");
		sfuClient.off("reconnect");

		document.removeEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySet,
		);
		document.removeEventListener(
			"meet:e2ee-handshake-complete",
			handleHandshakeComplete,
		);
		document.removeEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResync,
		);

		// Wipe chain state on disconnect so the next join starts fresh
		// (see docs/adr/0006-chain-tips-wiped-on-pagehide.md).
		meetingSecret.value?.fill(0);
		meetingSecret.value = null;
		joinerX25519Priv.value = null;
		joinerX25519PubB64.value = null;
		hostX25519Priv.value = null;
		hostX25519PubB64.value = null;
		joinerPubBySenderId.clear();
		keyVersion.value = null;
		wipeMeetingContext();
	};

	const handleGuestJoinResult = async (
		joinResult: Record<string, unknown>,
		guestName: string,
	) => {
		if (!guestName || !joinResult?.guest_id) {
			connectionState.connectionError =
				"Guest session not found. Please try joining again.";
			return;
		}

		try {
			connectionState.connectionError = null;

			sessionStorage.setItem("guest_id", joinResult.guest_id as string);
			sessionStorage.setItem("guest_name", guestName);
			sessionStorage.setItem("guest_meeting_id", meetingId);
			sessionStorage.setItem("guest_status", joinResult.status as string);
			if (joinResult.session_token) {
				sessionStorage.setItem(
					"guest_session_token",
					joinResult.session_token as string,
				);
			}

			connectionState.guestId = joinResult.guest_id as string;
			connectionState.guestAuthToken =
				(joinResult.auth_token as string) || null;
			connectionState.guestSfuUrl = (joinResult.sfu_url as string) || null;
			connectionState.guestSfuPort = (joinResult.sfu_port as string) || null;

			if (joinResult.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval = true;
				connectionState.isInPreview = false;
				connectionState.isConnecting = false;
				connectionState.guestAuthToken = null;
				setupGuestApprovalListener(guestName);
				return;
			}

			connectionState.isConnecting = true;
			await setupSFUConnection(guestName, false, false);
			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview = false;
			connectionState.isConnecting = false;
		} catch (error) {
			console.error("Failed to complete guest join:", error);
			connectionState.connectionError = getErrorMessage(error);
			connectionState.isConnecting = false;
		}
	};

	const joinMeetingRoom = async () => {
		if (joiningInProgress.value) {
			return;
		}

		try {
			joiningInProgress.value = true;
			connectionState.isConnecting = true;
			connectionState.connectionError = null;

			connectionState.guestAuthToken = null;
			connectionState.guestSfuUrl = null;
			connectionState.guestSfuPort = null;

			const response = (await joinMeetingAPI.fetch()) as
				| Record<string, unknown>
				| { message?: Record<string, unknown> };
			const joinResult = (
				"message" in response && response.message ? response.message : response
			) as Record<string, unknown>;

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval = true;
				connectionState.isInPreview = false;
				connectionState.isConnecting = false;
				setupFrappeRealtimeEventListeners();
				return;
			}

			await setupSFUConnection(
				null,
				(joinResult?.is_host || false) as boolean,
				(joinResult?.is_cohost || false) as boolean,
			);

			if (joinResult?.host_only_chat !== undefined) {
				chatStore.hostOnlyChat = !!joinResult.host_only_chat;
			}

			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview = false;
			connectionState.isConnecting = false;
		} catch (error) {
			console.error("Failed to join meeting:", error);
			connectionState.connectionError = getErrorMessage(error);
			connectionState.isConnecting = false;
		} finally {
			joiningInProgress.value = false;
		}
	};

	const endCall = async () => {
		try {
			stopGuestApprovalListener();

			if (activeSpeakerTimeout.value) {
				clearTimeout(activeSpeakerTimeout.value);
				activeSpeakerTimeout.value = null;
			}

			audioNotificationManager.playLeaveNotification(true);

			if (sfuManager.value) {
				await sfuManager.value.cleanup();
			}

			sfuManager.value = null;

			router.push({ name: "Home" });
		} catch (error) {
			console.error("Error ending call:", error);
			router.push({ name: "Home" });
		}
	};

	onUnmounted(async () => {
		hasShownE2EEKeyMismatchToast.value = false;

		if (activeSpeakerTimeout.value) {
			clearTimeout(activeSpeakerTimeout.value);
			activeSpeakerTimeout.value = null;
		}
		if (stabilityCheckTimeout) {
			clearTimeout(stabilityCheckTimeout);
			stabilityCheckTimeout = null;
		}

		stopGuestApprovalListener();
		removeFrappeRealtimeEventListeners();

		if (sfuManager.value) {
			await sfuManager.value.cleanup();
		}
		sfuManager.value = null;

		realtimeListenersSetup.value = false;
	});

	// T4.4: wipe chain state on pagehide. Chain tips are per-frame AES
	// keys; persisting them (even in memory across pagehide) is the same
	// anti-pattern the passphrase-in-localStorage model embodied. iOS Safari
	// suspend/resume triggers a fresh ECDH via the meeting:e2ee_enabled
	// path; this is the last-mile defense.
	if (typeof window !== "undefined") {
		const onPageHide = () => {
			meetingSecret.value?.fill(0);
			meetingSecret.value = null;
			joinerX25519Priv.value = null;
			joinerX25519PubB64.value = null;
			hostX25519Priv.value = null;
			hostX25519PubB64.value = null;
			joinerPubBySenderId.clear();
			keyVersion.value = null;
			wipeMeetingContext();
		};
		window.addEventListener("pagehide", onPageHide);
		onUnmounted(() => window.removeEventListener("pagehide", onPageHide));
	}

	return {
		sfuClient,
		sfuManager,
		joinMeetingRoom,
		handleGuestJoinResult,
		setupFrappeRealtimeEventListeners,
		endCall,
		fetchExistingWaitingRoomUsers,
	};
}
