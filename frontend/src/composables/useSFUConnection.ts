import { createResource, frappeRequest, toast } from "frappe-ui";
import {
	defineAsyncComponent,
	h,
	onUnmounted,
	type Ref,
	shallowRef,
} from "vue";
import { useRouter } from "vue-router";
import { useSocket } from "../socket.js";
import audioNotificationManager from "../utils/audioNotifications";
import { getSFUClient } from "../utils/sfu-client.js";
import {
	getSFUMeetingManager,
	resetSFUMeetingManager,
} from "../utils/sfu-meeting-manager.js";
import type { ConnectionState } from "./useConnectionState";
import type { CurrentUser } from "./useCurrentUser";
import type { GridLayout } from "./useGridLayout";
import type { LobbyStore } from "./useLobbyStore";
import type { MediaState } from "./useMediaState";
import type { ParticipantStore } from "./useParticipantStore";

interface SFUConnectionAPI {
	sfuManager: Ref<ReturnType<typeof getSFUMeetingManager> | null>;
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
	onScreenShareStarted: (data: Record<string, unknown>) => void;
	onScreenShareStopped: (data: Record<string, unknown>) => void;
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
	const sfuManager = shallowRef<ReturnType<typeof getSFUMeetingManager> | null>(
		null,
	);
	const realtimeListenersSetup = shallowRef(false);
	const joiningInProgress = shallowRef(false);

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
		const participantId =
			(participant as Record<string, unknown>).participantId ||
			participant?.user_id;
		const currentUserId = (
			currentUser.currentUser.value as Record<string, unknown>
		)?.user_id as string;

		if (
			!participantId ||
			participantId === currentUserId ||
			participant?.user_id === currentUserId
		) {
			return;
		}

		participantStore.addParticipant(participant);

		audioNotificationManager.playJoinNotification(
			(participant as Record<string, unknown>).participantId as string,
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
		const participant = participantStore.participants.value[participantId] as
			| Record<string, unknown>
			| undefined;
		const participantName = participant?.user_name || participantId;

		participantStore.removeParticipant(participantId);

		if (
			participantId ===
			(currentUser.currentUser.value as Record<string, unknown>)?.user_id
		) {
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
					const currentSet = new Set(participantStore.activeSpeakerIds.value);
					const startTimes = {
						...participantStore.speakerStartTimes.value,
					} as Record<string, number>;
					const currentStable = new Set(
						participantStore.stableSpeakerIds.value || [],
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

					participantStore.speakerStartTimes.value = startTimes;
					participantStore.stableSpeakerIds.value = Array.from(currentStable);

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
						participantStore.activeSpeakerIds.value = [];
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
		if (connectionState.isSetupComplete.value) {
			connectionState.isInPreview.value = false;
			connectionState.isConnecting.value = false;
			return;
		}

		try {
			sfuManager.value = getSFUMeetingManager();
			sfuManager.value.initialize({
				meetingId,
				currentUser: currentUser.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});

			if (!guestName) {
				setupFrappeRealtimeEventListeners();
			}

			await sfuManager.value.connect(connectionState.guestAuthToken.value);
			connectionState.codecStrategy.value =
				getSFUClient().getCodecStrategy() || "svc";

			let userData: Record<string, unknown>;
			if (guestName) {
				userData = {
					name: guestName,
					userId: connectionState.guestId.value || "",
					avatar: null,
					is_guest: true,
					isHost: false,
				};
			} else {
				userData = {
					name:
						(currentUser.currentUser.value as Record<string, unknown>)
							?.full_name ||
						(currentUser.currentUser.value as Record<string, unknown>)?.name ||
						"You",
					userId:
						(currentUser.currentUser.value as Record<string, unknown>)
							?.user_id || "",
					avatar:
						(currentUser.currentUser.value as Record<string, unknown>)
							?.avatar || "",
					is_guest: false,
					isHost,
				};
			}

			await sfuManager.value.joinRoom(userData, {
				audio_enabled: mediaState.isMicOn.value,
				video_enabled: mediaState.isCameraOn.value,
			});

			await sfuManager.value.initializeDevice();
			await sfuManager.value.createReceiveTransport();

			if (mediaState.localStream.value) {
				try {
					const videoTracks = mediaState.processedStream.value
						? mediaState.processedStream.value.getVideoTracks()
						: mediaState.localStream.value.getVideoTracks();

					const audioTracks = mediaState.localStream.value.getAudioTracks();

					const streamToPublish = new MediaStream([
						...videoTracks,
						...audioTracks,
					]);

					await sfuManager.value.publishMedia(streamToPublish, {
						publishVideo: mediaState.isCameraOn.value,
						publishAudio: mediaState.isMicOn.value,
					});
				} catch (error) {
					console.warn(
						"Media publishing failed, continuing without media:",
						(error as Error).message,
					);
				}
			}

			await sfuManager.value.setupExistingParticipants();

			connectionState.isSetupComplete.value = true;

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
			const result = await frappeRequest({
				url: "meet.api.meeting.get_waiting_room",
				params: { meeting_id: meetingId },
			});

			if ((result as Record<string, unknown>)?.waiting_users) {
				const transformedUsers = (
					(result as Record<string, unknown>).waiting_users as Record<
						string,
						unknown
					>[]
				).map((user) => ({
					userId: user.user_id as string,
					name: (user.full_name || user.user_id) as string,
					avatar: user.user_image as string,
					isGuest: (user.is_guest || false) as boolean,
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

			lobbyStore.isWaitingForApproval.value = false;

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
					connectionState.guestAuthToken.value = (
						response as Record<string, unknown>
					).auth_token as string;
					connectionState.guestSfuUrl.value =
						((response as Record<string, unknown>).sfu_url as string) || null;
					connectionState.guestSfuPort.value =
						((response as Record<string, unknown>).sfu_port as string) || null;

					await setupSFUConnection(resolvedGuestName);

					connectionState.isInPreview.value = false;
					connectionState.isConnecting.value = false;
				} else {
					console.error(
						"Failed to get connection details after approval:",
						response,
					);
					connectionState.connectionError.value =
						"Failed to get authorization token after approval";
				}
			} catch (error) {
				console.error(
					"Error fetching connection details after approval:",
					error,
				);
				connectionState.connectionError.value =
					"Failed to connect after approval";
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

			lobbyStore.isJoinRequestRejected.value = true;
			lobbyStore.isWaitingForApproval.value = false;

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
		const currentUserId = (
			currentUser.currentUser.value as Record<string, unknown>
		)?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isWaitingForApproval.value = false;

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
					connectionState.isInPreview.value = false;
				} else {
					console.error("Failed to get SFU connection:", sfuResult);
					lobbyStore.isJoinRequestRejected.value = true;
					toast.error("Failed to join meeting after approval");
				}
			} catch (error) {
				console.error("Error after approval:", error);
				connectionState.connectionError.value = (
					error as Record<string, unknown>
				)?.messages
					? ((error as Record<string, unknown>).messages as string[]).join(", ")
					: (error as Error).message || "Failed to join meeting after approval";
				toast.error("Failed to join meeting after approval");
			}
		}
	};

	const handleMeetingJoinRejected = (data: Record<string, unknown>) => {
		const currentUserId = (
			currentUser.currentUser.value as Record<string, unknown>
		)?.user_id;

		if (data.meeting === meetingId && data.user === currentUserId) {
			lobbyStore.isJoinRequestRejected.value = true;
			lobbyStore.isWaitingForApproval.value = false;

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

		realtimeListenersSetup.value = true;
	};

	const removeFrappeRealtimeEventListeners = () => {
		if (!socket) return;

		socket.off("meeting_join_request", handleMeetingJoinRequest);
		socket.off("meeting_join_approved", handleMeetingJoinApproved);
		socket.off("meeting_join_rejected", handleMeetingJoinRejected);
		socket.off("meeting_user_approved", handleMeetingUserApproved);
		socket.off("meeting_user_rejected", handleMeetingUserRejected);
	};

	const handleGuestJoinResult = async (
		joinResult: Record<string, unknown>,
		guestName: string,
	) => {
		if (!guestName || !joinResult?.guest_id) {
			connectionState.connectionError.value =
				"Guest session not found. Please try joining again.";
			return;
		}

		try {
			connectionState.connectionError.value = null;

			sessionStorage.setItem("guest_id", joinResult.guest_id as string);
			sessionStorage.setItem("guest_name", guestName);
			sessionStorage.setItem("guest_meeting_id", meetingId);
			sessionStorage.setItem("guest_status", joinResult.status as string);

			connectionState.guestId.value = joinResult.guest_id as string;
			connectionState.guestAuthToken.value =
				(joinResult.auth_token as string) || null;
			connectionState.guestSfuUrl.value =
				(joinResult.sfu_url as string) || null;
			connectionState.guestSfuPort.value =
				(joinResult.sfu_port as string) || null;

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval.value = true;
				connectionState.isInPreview.value = false;
				connectionState.isConnecting.value = false;
				connectionState.guestAuthToken.value = null;
				setupGuestApprovalListener(guestName);
				return;
			}

			connectionState.isConnecting.value = true;
			await setupSFUConnection(guestName, false, false);
			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview.value = false;
			connectionState.isConnecting.value = false;
		} catch (error) {
			console.error("Failed to complete guest join:", error);
			connectionState.connectionError.value = (error as Record<string, unknown>)
				?.messages
				? ((error as Record<string, unknown>).messages as string[]).join(", ")
				: (error as Error).message || "Failed to join meeting";
			connectionState.isConnecting.value = false;
		}
	};

	const joinMeetingRoom = async () => {
		if (joiningInProgress.value) {
			return;
		}

		try {
			joiningInProgress.value = true;
			connectionState.isConnecting.value = true;
			connectionState.connectionError.value = null;

			connectionState.guestAuthToken.value = null;
			connectionState.guestSfuUrl.value = null;
			connectionState.guestSfuPort.value = null;

			const response = await joinMeetingAPI.fetch();
			const joinResult = response as Record<string, unknown>;

			if (joinResult.status === "waiting_for_approval") {
				lobbyStore.isWaitingForApproval.value = true;
				connectionState.isInPreview.value = false;
				connectionState.isConnecting.value = false;
				setupFrappeRealtimeEventListeners();
				return;
			}

			await setupSFUConnection(
				null,
				(joinResult?.is_host || false) as boolean,
				(joinResult?.is_cohost || false) as boolean,
			);

			setupFrappeRealtimeEventListeners();
			connectionState.isInPreview.value = false;
			connectionState.isConnecting.value = false;

			if (router.currentRoute.value.query.created === "true") {
				router.replace({
					name: router.currentRoute.value.name as string,
					params: router.currentRoute.value.params,
					query: { ...router.currentRoute.value.query, created: undefined },
				});
			}
		} catch (error) {
			console.error("Failed to join meeting:", error);
			connectionState.connectionError.value = (error as Record<string, unknown>)
				?.messages
				? ((error as Record<string, unknown>).messages as string[]).join(", ")
				: (error as Error).message || "Failed to join meeting";
			connectionState.isConnecting.value = false;
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
				sfuManager.value.cleanup();
			}

			resetSFUMeetingManager();

			router.push({ name: "Home" });
		} catch (error) {
			console.error("Error ending call:", error);
			router.push({ name: "Home" });
		}
	};

	onUnmounted(() => {
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
			sfuManager.value.cleanup();
		}
		resetSFUMeetingManager();
		sfuManager.value = null;

		realtimeListenersSetup.value = false;
	});

	return {
		sfuManager,
		joinMeetingRoom,
		handleGuestJoinResult,
		setupFrappeRealtimeEventListeners,
		endCall,
		fetchExistingWaitingRoomUsers,
	};
}
