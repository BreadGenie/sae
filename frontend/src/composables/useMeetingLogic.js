import { createResource, toast } from "frappe-ui";
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
	cameraEnabled as prefCameraEnabled,
	micEnabled as prefMicEnabled,
	selectedCameraId,
	selectedMicId,
	setCameraEnabled,
	setMicEnabled,
	setSelectedCameraId,
	setSelectedMicId,
} from "../data/mediaPreferences.js";
import { publishScreenShare } from "../mediasoup-client.js";
import { useSocket } from "../socket.js";
import { deviceManager } from "../utils/media/DeviceManager.js";
import { getSFUClient } from "../utils/sfu-client.js";
import {
	getSFUMeetingManager,
	resetSFUMeetingManager,
} from "../utils/sfu-meeting-manager.js";

/**
 * Meeting Logic Composable
 * Handles all meeting-related business logic and integrations
 */
export function useMeetingLogic(meetingState, meetingId) {
	const router = useRouter();
	const socket = useSocket();

	// Refs
	const localVideo = ref(null);
	const sfuManager = ref(null);
	const screenShareVideoElements = new Map();
	const realtimeListenersSetup = ref(false);

	// API Resources
	const getMeetingInfo = createResource({
		url: "sae.api.meeting.get_meeting_info",
		method: "POST",
		makeParams: () => ({ meeting_id: meetingId }),
		onSuccess: (data) => {
			if (data.is_creator) {
				meetingState.isCreator.value = true;
			}
		},
	});

	const joinMeetingAPI = createResource({
		url: "sae.api.meeting.join_meeting",
		method: "POST",
		makeParams: () => ({ meeting_id: meetingId }),
	});

	// ==================== CAMERA & MEDIA SETUP ====================

	const buildMediaConstraints = (videoEnabled, audioEnabled) => {
		const constraints = {};
		const deviceIds = {};

		if (videoEnabled) {
			constraints.video = {};

			// Use stored camera ID if available (don't check if device exists to avoid enumeration)
			// If the device doesn't exist, getUserMedia will fail gracefully and we can handle it
			if (selectedCameraId.value) {
				deviceIds.camera = selectedCameraId.value;
			}
			// If no stored device ID, let browser use its default (don't enumerate)
		}

		if (audioEnabled) {
			constraints.audio = {};

			// Use stored microphone ID if available (don't check if device exists to avoid enumeration)
			if (selectedMicId.value) {
				deviceIds.microphone = selectedMicId.value;
			}
			// If no stored device ID, let browser use its default (don't enumerate)
		}

		return { constraints, deviceIds };
	};

	/**
	 * Initialize camera and media devices
	 */
	const initializeCamera = async () => {
		try {
			meetingState.setMediaState(prefMicEnabled.value, prefCameraEnabled.value);

			if (meetingState.isCameraOn.value || meetingState.isMicOn.value) {
				const { constraints, deviceIds } = buildMediaConstraints(
					meetingState.isCameraOn.value,
					meetingState.isMicOn.value,
				);

				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				meetingState.localStream.value = stream;
				// Clear any stale connection error on successful media acquisition
				if (meetingState.connectionError.value) {
					meetingState.connectionError.value = null;
				}
				console.log("📹 Camera initialized successfully");
			}
		} catch (error) {
			console.error("❌ Failed to initialize camera:", error);
			meetingState.connectionError.value = "Failed to access camera/microphone";
		}
	};

	/**
	 * Toggle microphone
	 */
	const toggleMicrophone = async () => {
		try {
			const enable = !meetingState.isMicOn.value;

			const mh = sfuManager.value?.mediaHandler;
			let stream = meetingState.localStream.value;

			if (enable) {
				// Turning mic ON
				if (!stream) {
					try {
						const { constraints, deviceIds } = buildMediaConstraints(
							true,
							enable,
						);
						stream = await navigator.mediaDevices.getUserMedia(constraints);
						meetingState.localStream.value = stream;
					} catch (err) {
						console.error("❌ Failed to get microphone stream:", err);
						toast.error("Failed to access microphone");
						return;
					}
				} else {
					// Existing stream: ensure we have an audio track
					const hasAudio = stream.getAudioTracks().length > 0;
					if (!hasAudio) {
						try {
							const { constraints, deviceIds } = buildMediaConstraints(
								false,
								true,
							);
							const audioOnly =
								await navigator.mediaDevices.getUserMedia(constraints);
							const newTrack = audioOnly.getAudioTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
							}
						} catch (err) {
							console.error("❌ Failed to add audio track:", err);
							toast.error("Could not enable microphone");
							return;
						}
					} else {
						// Ensure existing track is enabled, or get new if stopped
						const at = stream.getAudioTracks()[0];
						if (at.readyState === "ended") {
							// Track was stopped, get a new one
							try {
								const { constraints, deviceIds } = buildMediaConstraints(
									false,
									true,
								);
								const audioOnly =
									await navigator.mediaDevices.getUserMedia(constraints);
								const newTrack = audioOnly.getAudioTracks()[0];
								if (newTrack) {
									stream.removeTrack(at);
									stream.addTrack(newTrack);
								}
							} catch (err) {
								console.error("❌ Failed to replace audio track:", err);
								toast.error("Could not enable microphone");
								return;
							}
						} else {
							at.enabled = true;
						}
					}
				}

				// Publish or resume audio producer
				const track = stream.getAudioTracks()[0];
				if (mh?.audioProducer) {
					if (meetingState.isScreenSharing.value) {
						try {
							const currentTrack = mh.audioProducer.track;
							if (currentTrack && currentTrack.readyState === "ended") {
								await mh.audioProducer.replaceTrack({ track });
							} else {
								mh.audioProducer.resume?.();
								if (track) track.enabled = true;
							}
						} catch (_) {}
					} else {
						const producer =
							await sfuManager.value.transportManager.createProducer(track, {
								type: "microphone",
							});
						mh?.setProducers({ audioProducer: producer });
					}
				} else if (track && sfuManager.value?.transportManager) {
					const producer =
						await sfuManager.value.transportManager.createProducer(track, {
							type: "microphone",
						});
					mh?.setProducers({ audioProducer: producer });
				}
			} else {
				// Turning mic OFF
				if (stream) {
					const at = stream.getAudioTracks()[0];
					if (at) {
						if (meetingState.isScreenSharing.value) {
							// Keep track alive for resuming, else user can't unmute after screen share
							at.enabled = false;
						} else {
							at.stop();
							stream.removeTrack(at);
						}
					}
				}
				if (mh?.audioProducer) {
					if (meetingState.isScreenSharing.value) {
						try {
							mh.audioProducer.pause?.();
						} catch (_) {}
					} else {
						try {
							mh.audioProducer.close?.();

							const sfuClient = getSFUClient();
							if (sfuClient.isConnected()) {
								sfuClient.closeProducer(mh.audioProducer.id).catch(() => {});
							}
						} catch (_) {}

						mh.audioProducer = null;
					}
				}
			}

			meetingState.isMicOn.value = enable;
			setMicEnabled(enable);

			// Send media control update (server expects string actions as well)
			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "unmute" : "mute");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "audio", enabled: enable });
				}
			}

			console.log(`🎤 Microphone ${enable ? "enabled" : "disabled"}`);
		} catch (error) {
			console.error("❌ Failed to toggle microphone:", error);
			toast.error("Failed to toggle microphone");
		}
	};

	/**
	 * Toggle camera
	 */
	const toggleCamera = async () => {
		try {
			const enable = !meetingState.isCameraOn.value;

			const mh = sfuManager.value?.mediaHandler;
			let stream = meetingState.localStream.value;

			if (enable) {
				// Turning camera ON
				if (!stream) {
					// No existing stream: request both video and current audio state
					try {
						const { constraints, deviceIds } = buildMediaConstraints(
							true,
							meetingState.isMicOn.value,
						);
						stream = await navigator.mediaDevices.getUserMedia(constraints);
						meetingState.localStream.value = stream;
					} catch (err) {
						console.error("❌ Failed to get camera stream:", err);
						toast.error("Failed to access camera");
						return;
					}
				} else {
					// Existing stream: ensure we have a video track
					const hasVideo = stream.getVideoTracks().length > 0;
					if (!hasVideo) {
						try {
							const { constraints, deviceIds } = buildMediaConstraints(
								true,
								false,
							);
							const videoOnly =
								await navigator.mediaDevices.getUserMedia(constraints);
							const newTrack = videoOnly.getVideoTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
							}
						} catch (err) {
							console.error("❌ Failed to add video track:", err);
							toast.error("Could not enable camera");
							return;
						}
					} else {
						// Ensure existing track is enabled, or get new if stopped
						const vt = stream.getVideoTracks()[0];
						if (vt.readyState === "ended") {
							// Track was stopped, get a new one
							try {
								const { constraints, deviceIds } = buildMediaConstraints(
									true,
									false,
								);
								const videoOnly =
									await navigator.mediaDevices.getUserMedia(constraints);
								const newTrack = videoOnly.getVideoTracks()[0];
								if (newTrack) {
									stream.removeTrack(vt);
									stream.addTrack(newTrack);
								}
							} catch (err) {
								console.error("❌ Failed to replace video track:", err);
								toast.error("Could not enable camera");
								return;
							}
						} else {
							vt.enabled = true;
						}
					}
				}

				// Attach/refresh local video element (only if not screen sharing)
				if (localVideo.value && stream && !meetingState.isScreenSharing.value) {
					localVideo.value.srcObject = stream;
					try {
						await localVideo.value.play();
					} catch (_) {}
				}

				// Publish or resume producer
				const track = stream.getVideoTracks()[0];
				if (mh?.videoProducer) {
					if (meetingState.isScreenSharing.value) {
						try {
							const currentTrack = mh.videoProducer.track;
							if (currentTrack && currentTrack.readyState === "ended") {
								await mh.videoProducer.replaceTrack({ track });
							} else {
								mh.videoProducer.resume?.();
								if (track) track.enabled = true;
							}
						} catch (_) {}
					} else {
						const producer =
							await sfuManager.value.transportManager.createProducer(track, {
								type: "camera",
							});
						mh?.setProducers({ videoProducer: producer });
					}
				} else if (track && sfuManager.value?.transportManager) {
					const producer =
						await sfuManager.value.transportManager.createProducer(track, {
							type: "camera",
						});
					mh?.setProducers({ videoProducer: producer });
				}
			} else {
				// Turning camera OFF
				if (stream) {
					const vt = stream.getVideoTracks()[0];
					if (vt) {
						if (meetingState.isScreenSharing.value) {
							// Keep track alive for resuming, else user can't re-enable after screen share
							vt.enabled = false;
						} else {
							vt.stop();
							stream.removeTrack(vt);
						}
					}
				}
				if (mh?.videoProducer) {
					if (meetingState.isScreenSharing.value) {
						try {
							mh.videoProducer.pause?.();
						} catch (_) {}
					} else {
						try {
							mh.videoProducer.close?.();

							const sfuClient = getSFUClient();
							if (sfuClient.isConnected()) {
								sfuClient.closeProducer(mh.videoProducer.id).catch(() => {});
							}
						} catch (_) {}

						mh.videoProducer = null;
					}
				}
			}

			meetingState.isCameraOn.value = enable;
			setCameraEnabled(enable);

			// Send media control update (server expects string actions as well)
			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "video_on" : "video_off");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "video", enabled: enable });
				}
			}

			console.log(`📹 Camera ${enable ? "enabled" : "disabled"}`);
		} catch (error) {
			console.error("❌ Failed to toggle camera:", error);
			toast.error("Failed to toggle camera");
		}
	};

	const toggleScreenShare = async () => {
		try {
			if (meetingState.isScreenSharing.value) {
				// Stop screen sharing
				if (sfuManager.value?.mediaHandler) {
					try {
						// If there is a screen producer, close it (local producer cleanup)
						const sp = sfuManager.value.mediaHandler.screenProducer;
						if (sp?.id) {
							try {
								sp.close?.();
							} catch (_) {}
							// Ask SFU to close the producer so it notifies other peers
							try {
								const sfuClient = getSFUClient();
								if (sfuClient.isConnected()) {
									sfuClient.closeProducer(sp.id).catch(() => {});
								}
							} catch (_) {}
						}
						// Local media handler track cleanup
						sfuManager.value.mediaHandler.stopScreenShare();
					} catch (_) {}
				}
				// Proactively stop all local display tracks so browser indicator clears
				try {
					const tracks = meetingState.screenShareStream.value?.getTracks?.();
					if (tracks) {
						for (const t of tracks) {
							t.stop();
						}
					}
				} catch (_) {}
				meetingState.isScreenSharing.value = false;
				// Remove local entry from stream map (if stored)
				const selfId = meetingState.currentUser.value?.user_id;
				if (selfId && meetingState.screenShareStreams.value) {
					if (meetingState.screenShareStreams.value[selfId]) {
						delete meetingState.screenShareStreams.value[selfId];
					}
				}
				meetingState.screenShareStream.value = null;
				const sfuClient = getSFUClient();
				if (sfuClient.isConnected()) {
					try {
						sfuClient.sendScreenShare("stop_share");
					} catch (_) {}
				}
				console.log("🖥️ Screen sharing stopped (tracks closed)");
			} else {
				// Start screen sharing (Firefox-friendly)
				let screenStream = null;
				const getDisplay =
					navigator.mediaDevices?.getDisplayMedia || navigator.getDisplayMedia;
				if (!getDisplay)
					throw new Error("getDisplayMedia not supported in this browser");
				// Request video-only for screen sharing. We do NOT publish screen audio in
				// this app; requesting audio from getDisplayMedia can cause some browsers
				// to replace or end the system microphone track which breaks live audio.
				screenStream = await getDisplay.call(
					navigator.mediaDevices || navigator,
					{
						video: { frameRate: { ideal: 15, max: 30 } },
					},
				);
				if (!screenStream)
					throw new Error("Failed to obtain screen share stream");

				meetingState.screenShareStream.value = screenStream;
				meetingState.isScreenSharing.value = true;
				meetingState.localScreenShareStartedAt.value = Date.now();

				// Publish via mediasoup
				try {
					const producer = await publishScreenShare(meetingId, screenStream);
					// Store reference on mediaHandler so we can close it when stopping
					try {
						if (sfuManager.value?.mediaHandler) {
							sfuManager.value.mediaHandler.setProducers({
								screenProducer: producer,
							});
						}
					} catch (_) {}

					// Ensure audio producer remains active/independent of screen producer
					try {
						const mh = sfuManager.value?.mediaHandler;
						// If there's an audioProducer and it's paused, resume it
						if (mh?.audioProducer?.paused) {
							try {
								mh.audioProducer.resume?.();
							} catch (_) {
								console.warn(
									"⚠️ Failed to resume audioProducer after starting screen share",
								);
							}
						}
						// If no audioProducer exists but we have a local mic track, publish it
						if (!mh?.audioProducer) {
							const localStream = meetingState.localStream.value;
							const micTrack = localStream?.getAudioTracks?.()[0];
							if (micTrack && sfuManager.value?.transportManager) {
								try {
									const newProducer =
										await sfuManager.value.transportManager.createProducer(
											micTrack,
											{ type: "microphone" },
										);
									mh?.setProducers({ audioProducer: newProducer });
									console.log(
										"🎧 Re-published microphone producer after starting screen share",
									);
								} catch (err) {
									console.warn(
										"⚠️ Failed to publish mic producer after starting screen share",
										err,
									);
								}
							}
						}
					} catch (err) {
						console.warn(
							"⚠️ Error ensuring audio producer after screen share start:",
							err,
						);
					}
				} catch (pubErr) {
					console.error("❌ Failed to publish screen share producer:", pubErr);
					meetingState.isScreenSharing.value = false;
					meetingState.screenShareStream.value = null;
					for (const t of screenStream.getTracks()) {
						t.stop();
					}
					throw pubErr;
				}

				// Auto-stop when user ends share from browser UI
				screenStream.getVideoTracks()[0].addEventListener("ended", () => {
					if (meetingState.isScreenSharing.value) {
						try {
							toggleScreenShare();
						} catch (_) {}
					}
				});

				const sfuClient = getSFUClient();
				if (sfuClient.isConnected()) {
					sfuClient.sendScreenShare("start_share", {
						startedAt: meetingState.localScreenShareStartedAt.value,
					});
				}

				console.log("🖥️ Screen sharing started (published)");
			}
		} catch (error) {
			if (error.name === "NotAllowedError") {
				console.log("👤 User cancelled screen share");
			} else {
				console.error("❌ Screen share failed:", error);
				toast.error("Failed to start screen sharing");
			}
		}
	};

	// ==================== MEETING MANAGEMENT ====================

	/**
	 * Join meeting room
	 */
	const joinMeetingRoom = async () => {
		try {
			meetingState.isConnecting.value = true;
			meetingState.connectionError.value = null;

			// Join meeting via API
			const joinResult = await joinMeetingAPI.submit();

			if (joinResult.status === "waiting_for_approval") {
				meetingState.isWaitingForApproval.value = true;
				meetingState.isConnecting.value = false;

				// for approval/rejection events
				setupFrappeRealtimeEventListeners();
				return;
			}

			if (joinResult.rejected) {
				meetingState.isJoinRequestRejected.value = true;
				meetingState.isConnecting.value = false;
				return;
			}

			// Initialize SFU connection
			console.log("🔄 Starting SFU connection setup...");
			await setupSFUConnection();

			setupFrappeRealtimeEventListeners();

			console.log("🔄 Updating meeting state after successful SFU setup...");
			meetingState.isInPreview.value = false;
			meetingState.isConnecting.value = false;

			// Remove the created=true query parameter since we've successfully joined
			if (router.currentRoute.value.query.created === "true") {
				router.replace({
					name: router.currentRoute.value.name,
					params: router.currentRoute.value.params,
					query: { ...router.currentRoute.value.query, created: undefined },
				});
			}

			console.log("✅ Successfully joined meeting", {
				isInPreview: meetingState.isInPreview.value,
				isConnecting: meetingState.isConnecting.value,
				isWaitingForApproval: meetingState.isWaitingForApproval.value,
			});
		} catch (error) {
			console.error("❌ Failed to join meeting:", error);
			meetingState.connectionError.value =
				error.message || "Failed to join meeting";
			meetingState.isConnecting.value = false;
		}
	};

	/**
	 * Setup SFU connection and media publishing
	 */
	const setupSFUConnection = async () => {
		if (meetingState.isSetupComplete.value) {
			console.log("✅ SFU setup already complete");
			// Still need to update meeting state even if SFU is already set up
			meetingState.isInPreview.value = false;
			meetingState.isConnecting.value = false;
			return;
		}

		try {
			// Initialize SFU manager
			sfuManager.value = getSFUMeetingManager();
			sfuManager.value.initialize({
				meetingId,
				currentUser: meetingState.currentUser.value,
				eventHandlers: createSFUEventHandlers(),
			});

			setupFrappeRealtimeEventListeners();

			// Connect to SFU
			await sfuManager.value.connect();
			await sfuManager.value.initializeDevice();
			await sfuManager.value.createReceiveTransport();

			// Publish local media if available
			if (meetingState.localStream.value) {
				try {
					await sfuManager.value.publishMedia(meetingState.localStream.value, {
						publishVideo: meetingState.isCameraOn.value,
						publishAudio: meetingState.isMicOn.value,
					});
					console.log("✅ Media publishing completed");
				} catch (error) {
					console.warn(
						"⚠️ Media publishing failed, continuing without media:",
						error.message,
					);
					// Continue with meeting setup even if media publishing fails
				}
			}

			// Setup existing participants
			await sfuManager.value.setupExistingParticipants();

			meetingState.isSetupComplete.value = true;
			console.log("✅ SFU connection setup complete");

			// Fetch waiting room, so that owner can approve/reject pending requests
			sfuManager.value?.waitingRoomManager?.getWaitingRoom();
		} catch (error) {
			console.error("❌ SFU setup failed:", error);
			throw error;
		}
	};

	const setupFrappeRealtimeEventListeners = () => {
		if (realtimeListenersSetup.value) {
			return;
		}

		if (!socket) {
			console.warn("⚠️ Socket not available for realtime events");
			return;
		}

		socket.on("meeting_join_request", (data) => {
			if (data.meeting === meetingId) {
				const userData = {
					user_id: data.user,
					user_name: data.user_name,
					user_image: data.user_image,
					requested_at: new Date().toISOString(),
				};
				sfuManager.value?.waitingRoomManager?.addWaitingUser(userData);
			}
		});

		socket.on("meeting_join_approved", (data) => {
			if (
				data.meeting === meetingId &&
				data.user === meetingState.currentUser.value?.user_id
			) {
				startMeetingAfterApproval();
			}
		});

		socket.on("meeting_join_rejected", (data) => {
			if (
				data.meeting === meetingId &&
				data.user === meetingState.currentUser.value?.user_id
			) {
				meetingState.isJoinRequestRejected.value = true;
				meetingState.isWaitingForApproval.value = false;

				toast.error("Your join request was denied by the meeting host");
			}
		});

		realtimeListenersSetup.value = true;
	};

	/**
	 * Create SFU event handlers
	 */
	const createSFUEventHandlers = () => {
		return {
			onParticipantJoined: (participant) => {
				meetingState.addParticipant(participant);
				console.log("👥 Participant joined:", participant);
			},

			onParticipantLeft: ({ participantId }) => {
				meetingState.removeParticipant(participantId);
				console.log("👋 Participant left:", participantId);
			},

			onParticipantUpdated: (participantId, participant, updates) => {
				// Propagate updates to meeting state so UI reacts
				if (participantId) {
					meetingState.updateParticipant(participantId, updates || {});
				}
				console.log("📝 Participant updated:", participantId, updates);
			},
			onScreenShareStarted: (data) => {
				const pid = data.participantId;
				if (!pid) return;
				try {
					console.log("🔎 onScreenShareStarted raw payload", {
						participantId: pid,
						hasStream: data.stream instanceof MediaStream,
						consumerId: data.consumer?.id,
						consumerKind: data.consumer?.kind,
						consumerIsScreen:
							data.consumer?.isScreen ||
							data.consumer?.appData?.type === "screen",
					});
				} catch (_) {}
				const prev = meetingState.activeScreenShareConsumers.value || [];
				const filtered = prev.filter((s) => s.participantId !== pid);
				meetingState.activeScreenShareConsumers.value = [
					...filtered,
					{
						participantId: pid,
						consumerId: data.consumer?.id || "remote-screen",
						startedAt: data.startedAt || Date.now(),
					},
				];
				if (data.stream instanceof MediaStream) {
					try {
						// Ensure a plain-object store for screen share streams
						const store = meetingState.screenShareStreams?.value || {};
						store[pid] = data.stream;
						meetingState.screenShareStreams.value = store;
						const el = screenShareVideoElements.get(pid);
						if (el && el.srcObject !== data.stream) {
							el.srcObject = data.stream;
							el.play?.().catch(() => {});
						}
					} catch (err) {
						console.warn("⚠️ Failed to store screen share stream:", err);
					}
				}
				console.log("🖥️ Screen share started:", {
					participantId: pid,
					hasStream: !!data.stream,
				});
			},
			onScreenShareStopped: (data) => {
				const pid = data.participantId;
				const list = meetingState.activeScreenShareConsumers.value || [];
				meetingState.activeScreenShareConsumers.value = list.filter(
					(share) => share.participantId !== pid,
				);
				try {
					const store = meetingState.screenShareStreams?.value || {};
					if (pid && store[pid]) {
						const stream = store[pid];
						const tracks = stream?.getTracks?.();
						if (tracks) {
							for (const t of tracks) {
								t.stop();
							}
						}
						delete store[pid];
						meetingState.screenShareStreams.value = store;
					}
				} catch (_) {}
				console.log("🖥️ Screen share stopped:", data);
			},
			onWaitingRoomUpdated: (waitingUsers) => {
				meetingState.waitingUsers.value = waitingUsers;
			},
		};
	};

	/**
	 * End call and cleanup
	 */
	const endCall = async () => {
		try {
			// Cleanup SFU manager
			if (sfuManager.value) {
				sfuManager.value.cleanup();
			}

			// Reset SFU manager instance
			resetSFUMeetingManager();

			// Navigate to home
			router.push({ name: "Home" });

			console.log("📞 Call ended");
		} catch (error) {
			console.error("❌ Error ending call:", error);
			// Still navigate away even if cleanup fails
			router.push({ name: "Home" });
		}
	};

	// ==================== WAITING ROOM MANAGEMENT ====================

	/**
	 * Start meeting after approval
	 */
	const startMeetingAfterApproval = async () => {
		try {
			meetingState.isWaitingForApproval.value = false;
			await setupSFUConnection();
			meetingState.isInPreview.value = false;
		} catch (error) {
			console.error("❌ Failed to start meeting after approval:", error);
			meetingState.connectionError.value = error.message;
		}
	};

	/**
	 * Approve user join request
	 */
	const approveUser = async (userId) => {
		if (sfuManager.value?.waitingRoomManager) {
			await sfuManager.value.waitingRoomManager.approveUser(userId);
		}
	};

	/**
	 * Reject user join request
	 */
	const rejectUser = async (userId) => {
		if (sfuManager.value?.waitingRoomManager) {
			await sfuManager.value.waitingRoomManager.rejectUser(userId);
		}
	};

	// ==================== VIDEO ELEMENT MANAGEMENT ====================

	/**
	 * Set local video element reference
	 */
	const setLocalVideoRef = (el) => {
		localVideo.value = el;
		if (el && meetingState.localStream.value) {
			el.srcObject = meetingState.localStream.value;
		}
		// Expose on meetingState for external watchers that auto-play
		meetingState.localVideo = el;
	};

	/**
	 * Set remote video element reference
	 */
	const setRemoteVideoRef = (participantId, el) => {
		if (sfuManager.value?.videoManager) {
			sfuManager.value.videoManager.registerVideoElement(participantId, el);
		}
	};

	/**
	 * Set screen share video element reference
	 */
	const setScreenShareVideoRef = (el) => {
		if (!el) return;

		const participantId = el.dataset?.participantId;
		if (participantId) {
			screenShareVideoElements.set(participantId, el);

			// Attach screen share stream if available. Support both Map and plain-object stores.
			let stream = null;
			try {
				const store = meetingState.screenShareStreams?.value || {};
				// plain object keyed by participantId
				stream = store[participantId] || null;
				// Fallback: if this participant is the local sharer use single stream ref
				if (
					!stream &&
					meetingState.currentUser.value?.user_id === participantId
				) {
					stream = meetingState.screenShareStream?.value || null;
				}
			} catch (err) {
				console.warn("⚠️ Failed to access screenShareStreams store", err);
			}
			// If no stream yet, registration will allow onScreenShareStarted to attach later
			if (stream instanceof MediaStream) {
				el.srcObject = stream;
				el.play?.().catch(() => {});
			}
		}
	};

	// ==================== CHAT FUNCTIONALITY ====================

	/**
	 * Setup chat events
	 */
	const setupChatEvents = (notificationQueue) => {
		try {
			const sfuClient = getSFUClient();

			sfuClient.on("chat:message", (data) => {
				const message = {
					id: Date.now() + Math.random(),
					user_id: data.fromUser,
					user_name: data.fromName || data.fromUser,
					message: data.message,
					timestamp: new Date().toISOString(),
				};

				if (!meetingState.chatMessages.value) {
					meetingState.chatMessages.value = [];
				}
				meetingState.chatMessages.value.push(message);

				if (
					!meetingState.isChatOpen.value &&
					data.fromUser !== meetingState.currentUser.value?.user_id
				) {
					meetingState.hasUnreadMessages.value = true;

					if (notificationQueue?.addNotification) {
						notificationQueue.addNotification({
							message: data.message,
							fromUser: data.fromUser,
							fromName: data.fromName || data.fromUser,
							timestamp: message.timestamp,
						});
					}
				}
			});
		} catch (error) {
			console.error("❌ Failed to setup chat events:", error);
		}
	};

	/**
	 * Send chat message
	 */
	const onSendChat = (text) => {
		try {
			const message = {
				id: Date.now() + Math.random(),
				user_id: meetingState.currentUser.value?.user_id,
				user_name:
					meetingState.currentUser.value?.full_name ||
					meetingState.currentUser.value?.name ||
					meetingState.currentUser.value?.user_id,
				message: text,
				timestamp: new Date().toISOString(),
			};
			if (!meetingState.chatMessages.value) {
				meetingState.chatMessages.value = [];
			}
			meetingState.chatMessages.value.push(message);

			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				sfuClient.sendChatMessage(text, {
					clientId: meetingState.currentUser.value?.user_id,
				});
			}
		} catch (error) {
			console.error("❌ Failed to send chat message:", error);
			toast.error("Failed to send message");
		}
	};

	// ==================== KEYBOARD SHORTCUTS ====================

	/**
	 * Handle keyboard shortcuts
	 */
	const handleKeyDown = (event) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "d") {
			event.preventDefault();
			toggleMicrophone();
		}
		if ((event.metaKey || event.ctrlKey) && event.key === "e") {
			event.preventDefault();
			toggleCamera();
		}
	};

	// ==================== CLEANUP ====================

	onUnmounted(() => {
		// Cleanup SFU manager (disconnect and free resources)
		try {
			sfuManager.value?.cleanup?.();
		} catch (_) {}

		// Reset SFU manager instance
		try {
			resetSFUMeetingManager();
		} catch (_) {}

		// Cleanup local streams
		if (meetingState.localStream.value) {
			for (const track of meetingState.localStream.value.getTracks()) {
				track.stop();
			}
		}

		if (meetingState.screenShareStream.value) {
			for (const track of meetingState.screenShareStream.value.getTracks()) {
				track.stop();
			}
		}
	});

	return {
		// Refs
		sfuManager,
		localVideo,

		// Methods - Media
		initializeCamera,
		toggleMicrophone,
		toggleCamera,
		toggleScreenShare,

		// Methods - Meeting
		joinMeetingRoom,
		startMeetingAfterApproval,
		endCall,

		// Methods - Waiting Room
		approveUser,
		rejectUser,

		// Methods - Video Elements
		setLocalVideoRef,
		setRemoteVideoRef,
		setScreenShareVideoRef,

		// Methods - Chat
		setupChatEvents,
		onSendChat,

		// Methods - Keyboard
		handleKeyDown,
	};
}
