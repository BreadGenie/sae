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
	exportPublicKey,
	importPublicKey,
	openEnvelope,
	setV2MeetingContext,
	wipeV2MeetingContext,
	x25519KeyPair,
} from "../utils/media/e2ee";
import { SocketIOSignalChannel } from "../utils/media/SignalChannel";
import { SFUClient } from "../utils/SFUClient";
import { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { useChatStore } from "./useChatStore";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
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

	// E2EE v2 handshake state.
	// hostX25519Priv / hostX25519Pub are populated when this tab is the host
	// who enabled E2EE. joinerX25519Priv is populated for joiners and used to
	// open the host's envelope. v2MeetingSecret is the meeting-shared secret
	// derived from the envelope exchange; null until the handshake completes.
	const hostX25519Priv = shallowRef<CryptoKey | null>(null);
	const hostX25519PubB64 = shallowRef<string | null>(null);
	const joinerX25519Priv = shallowRef<CryptoKey | null>(null);
	const joinerX25519PubB64 = shallowRef<string | null>(null);
	const joinerPubBySenderId = new Map<number, string>();
	const v2MeetingSecret = shallowRef<Uint8Array<ArrayBuffer> | null>(null);
	const v2KeyVersion = shallowRef<number | null>(null);
	const { beginJoinerHandshake, openJoinerEnvelope, buildHostEnvelope } =
		useE2EEHandshake();

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
		isHost = false,
		isCohost = false,
	) => {
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

			if (!guestName) {
				setupFrappeRealtimeEventListeners();
			}

			await manager.connect(connectionState.guestAuthToken);
			connectionState.codecStrategy = sfuClient.getCodecStrategy() || "svc";

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
				const response = await frappeRequest({
					url: "meet.api.meeting.get_approved_guest_connection_details",
					params: {
						meeting_id: meetingId,
						guest_id: guestId,
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

	const startV2HandshakeAsJoiner = async (
		hostX25519PubB64Param: string,
		keyVersionString: string,
	) => {
		if (joinerX25519Priv.value) {
			return;
		}
		const kp = await x25519KeyPair();
		joinerX25519Priv.value = kp.privateKey;
		joinerX25519PubB64.value = await exportPublicKey(kp.publicKey);
		const versionNumber = parseKeyVersion(keyVersionString);
		v2KeyVersion.value = versionNumber;

		const participantId = currentUser.currentUser.value?.user_id || "";
		const senderId = sfuClient.getOwnSenderId?.() ?? 0;
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: participantId,
			fromSenderId: senderId,
			x25519PublicKey: joinerX25519PubB64.value,
		});
		hostX25519PubB64.value = hostX25519PubB64Param;
	};

	const handleV2HandshakeEnvelope = async (data: {
		fromParticipantId: string;
		fromSenderId: number;
		toParticipantId?: string;
		toSenderId?: number;
		envelope?: string;
	}) => {
		if (!data.envelope) {
			return;
		}
		if (
			!joinerX25519Priv.value ||
			!hostX25519PubB64.value ||
			v2KeyVersion.value == null
		) {
			return;
		}
		const ownParticipantId = currentUser.currentUser.value?.user_id || "";
		if (data.toParticipantId && data.toParticipantId !== ownParticipantId) {
			return;
		}
		const kp: CryptoKeyPair = {
			privateKey: joinerX25519Priv.value,
			publicKey: null as unknown as CryptoKey,
		};
		const secret = await openJoinerEnvelope(
			kp,
			hostX25519PubB64.value,
			data.envelope,
			{ meetingId, keyVersion: v2KeyVersion.value },
		);
		v2MeetingSecret.value = secret;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: secret,
					keyVersion: v2KeyVersion.value,
				},
			}),
		);
	};

	const handleV2JoinerHello = async (data: {
		fromParticipantId: string;
		fromSenderId: number;
		x25519PublicKey?: string;
	}) => {
		if (!data.x25519PublicKey) {
			return;
		}
		if (
			!hostX25519Priv.value ||
			!v2MeetingSecret.value ||
			v2KeyVersion.value == null
		) {
			return;
		}
		joinerPubBySenderId.set(data.fromSenderId, data.x25519PublicKey);
		const envelope = await buildHostEnvelope(
			hostX25519Priv.value,
			data.x25519PublicKey,
			v2MeetingSecret.value,
			{ meetingId, keyVersion: v2KeyVersion.value },
		);
		const ownParticipantId = currentUser.currentUser.value?.user_id || "";
		const ownSenderId = sfuClient.getOwnSenderId?.() ?? 0;
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: ownParticipantId,
			fromSenderId: ownSenderId,
			toParticipantId: data.fromParticipantId,
			toSenderId: data.fromSenderId,
			envelope,
		});
	};

	const handleV2HandshakeMessage = (data: unknown) => {
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
		};
		if (msg.envelope) {
			void handleV2HandshakeEnvelope(
				msg as Parameters<typeof handleV2HandshakeEnvelope>[0],
			);
		} else if (msg.x25519PublicKey) {
			void handleV2JoinerHello(
				msg as Parameters<typeof handleV2JoinerHello>[0],
			);
		}
	};

	const handleHostE2EEKeySet = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (detail?.hostX25519KeyPair && detail?.keyVersion) {
			// Host side stores its X25519 keypair + key version.
			hostX25519Priv.value = detail.hostX25519KeyPair.privateKey;
			hostX25519PubB64.value = null;
			void exportPublicKey(detail.hostX25519KeyPair.publicKey).then((b64) => {
				hostX25519PubB64.value = b64;
			});
			v2KeyVersion.value = parseKeyVersion(detail.keyVersion);
			// Host must also generate its own meeting_secret; we wait for the
			// convert_meeting_to_e2ee response to confirm the host's X25519
			// pubkey, then we derive the secret locally.
			void generateHostMeetingSecret();
		}
	};

	async function generateHostMeetingSecret() {
		const ms = new Uint8Array(32);
		globalThis.crypto.getRandomValues(ms);
		v2MeetingSecret.value = ms;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: ms,
					keyVersion: v2KeyVersion.value,
				},
			}),
		);
	}

	function parseKeyVersion(s: string): number {
		const m = /^v(\d+)-/.exec(s);
		return m ? Number(m[1]) : 0;
	}

	document.addEventListener("meet:e2ee-host-enabled", handleHostE2EEKeySet);

	const handleV2HandshakeComplete = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (!detail?.meetingSecret || detail?.keyVersion == null) {
			return;
		}
		if (detail.meetingId && detail.meetingId !== meetingId) {
			return;
		}
		setV2MeetingContext(
			detail.meetingSecret as Uint8Array<ArrayBuffer>,
			Number(detail.keyVersion),
		);
	};
	document.addEventListener(
		"meet:e2ee-handshake-complete",
		handleV2HandshakeComplete,
	);

	const resyncV2Handshake = () => {
		wipeV2MeetingContext();
		joinerX25519Priv.value = null;
		joinerX25519PubB64.value = null;
		v2KeyVersion.value = null;
		if (!hostX25519PubB64.value) return;
		if (!sfuManager.value || !sfuClient.connected) return;
		void startV2HandshakeAsJoiner(
			hostX25519PubB64.value,
			`v${v2KeyVersion.value ?? 1}-`,
		);
	};

	const handleE2EEResync = (event: Event) => {
		const detail = (
			event as CustomEvent<{
				senderId: number;
				generation: number;
				threshold: number;
			}>
		).detail;
		console.warn(
			`E2EE v2: missed ~${detail.threshold}+ frames from sender ${detail.senderId} (gen ${detail.generation}), re-syncing`,
		);
		resyncV2Handshake();
	};
	document.addEventListener("meet:e2ee-needs-key-resync", handleE2EEResync);

	const handleMeetingE2EEEnabled = async (data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_key_version?: string;
	}) => {
		if (data.meeting_id !== meetingId) return;
		if (isReconfiguringForE2EE) return;

		// v2 path: if the realtime payload carries the host's X25519 pubkey
		// and a key version, start the v2 handshake. The v1 passphrase
		// path below still runs in parallel for v1 media encryption.
		if (data.e2ee_host_public_key && data.e2ee_key_version) {
			try {
				await startV2HandshakeAsJoiner(
					data.e2ee_host_public_key,
					data.e2ee_key_version,
				);
			} catch (err) {
				console.error("E2EE v2 handshake (joiner) failed:", err);
			}
		}

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

		sfuClient.signalChannel.on("e2ee:handshake", handleV2HandshakeMessage);

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

		sfuClient.signalChannel.off("e2ee:handshake", handleV2HandshakeMessage);

		document.removeEventListener("meet:e2ee-host-enabled", handleHostE2EEKeySet);
		document.removeEventListener(
			"meet:e2ee-handshake-complete",
			handleV2HandshakeComplete,
		);
		document.removeEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResync,
		);

		// Wipe v2 chain state on disconnect so the next join starts fresh
		// (see docs/adr/0006-chain-tips-wiped-on-pagehide.md).
		v2MeetingSecret.value = null;
		joinerX25519Priv.value = null;
		joinerX25519PubB64.value = null;
		hostX25519Priv.value = null;
		hostX25519PubB64.value = null;
		joinerPubBySenderId.clear();
		v2KeyVersion.value = null;
		wipeV2MeetingContext();
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

			const response = await joinMeetingAPI.fetch();
			const joinResult = response as Record<string, unknown>;

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

	// T4.4: wipe v2 chain state on pagehide. Chain tips are per-frame AES
	// keys; persisting them (even in memory across pagehide) is the same
	// anti-pattern v1's passphrase-in-localStorage embodied. iOS Safari
	// suspend/resume triggers a fresh ECDH via the meeting:e2ee_enabled
	// path; this is the last-mile defense.
	if (typeof window !== "undefined") {
		const onPageHide = () => {
			v2MeetingSecret.value = null;
			joinerX25519Priv.value = null;
			joinerX25519PubB64.value = null;
			hostX25519Priv.value = null;
			hostX25519PubB64.value = null;
			joinerPubBySenderId.clear();
			v2KeyVersion.value = null;
			wipeV2MeetingContext();
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
