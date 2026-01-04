import { createResource, frappeRequest, toast } from "frappe-ui";
import { defineAsyncComponent, h, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
	cameraEnabled as prefCameraEnabled,
	micEnabled as prefMicEnabled,
	selectedCameraId,
	selectedMicId,
	selectedSpeakerId,
	setCameraEnabled,
	setMicEnabled,
	setSelectedCameraId,
	setSelectedMicId,
	setSelectedSpeakerId,
} from "../data/mediaPreferences.js";
import { publishScreenShare } from "../mediasoup-client.js";
import { useSocket } from "../socket.js";
import audioNotificationManager from "../utils/audioNotifications";
import { deviceManager } from "../utils/media/DeviceManager.js";
import notificationContextManager from "../utils/notificationContext";
import { getSFUClient } from "../utils/sfu-client.js";
import {
	getSFUMeetingManager,
	resetSFUMeetingManager,
} from "../utils/sfu-meeting-manager.js";
import { useBackgroundEffects } from "./useBackgroundEffects";

function getBackgroundEffectsFromStorage() {
	const blurEnabled = localStorage.getItem("backgroundEffects.blur") === "1";
	const imageEnabled = localStorage.getItem("backgroundEffects.image") === "1";
	const selectedImage =
		localStorage.getItem("backgroundEffects.imageName") || "";
	const blurIntensity = Number.parseInt(
		localStorage.getItem("backgroundEffects.blurIntensity") || "12",
	);
	const anyEnabled = blurEnabled || imageEnabled;

	return {
		blurEnabled,
		imageEnabled,
		selectedImage,
		blurIntensity,
		anyEnabled,
	};
}

/**
 * Meeting Logic Composable
 * Handles all meeting-related business logic and integrations
 */
export function useMeetingLogic(meetingState, meetingId, options = {}) {
	const { notifiedLobbyUsers } = options;
	const router = useRouter();
	const socket = useSocket();

	// Refs
	const localVideo = ref(null);
	const sfuManager = ref(null);
	const screenShareVideoElements = new Map();
	const realtimeListenersSetup = ref(false);
	const activeSpeakerTimeout = ref(null);
	const joiningInProgress = ref(false);

	// Background effects
	const { applyBackgroundEffects, stopProcessing, processedStream } =
		useBackgroundEffects();

	let backgroundSession = null;
	let shouldApplyBackgroundEffectsWhenVideoAvailable = false;

	const replacePublishedVideoTrack = async (
		stream,
		reason = "background-effect",
	) => {
		const manager = sfuManager.value;
		const mediaHandler = manager?.mediaHandler;
		if (!mediaHandler?.videoProducer || meetingState.isScreenSharing.value) {
			return;
		}

		const targetStream = stream || meetingState.localStream.value;
		if (!targetStream) {
			return;
		}

		const [track] = targetStream.getVideoTracks();
		if (!track) {
			console.warn(
				`Skipped video track swap (${reason}) - no video track available`,
			);
			return;
		}
		if (track.readyState === "ended") {
			console.warn(
				`Skipped video track swap (${reason}) - track already ended`,
			);
			return;
		}

		try {
			await mediaHandler.videoProducer.replaceTrack({ track });
			track.enabled = true;
			console.log(`Replaced video track (${reason})`);

			// Update local video element after track replacement
			if (localVideo.value) {
				setLocalVideoRef(localVideo.value);
			}
		} catch (error) {
			console.warn(`Failed to replace video track (${reason}):`, error);
		}
	};

	/**
	 * Apply background effects to local stream and update processedStream
	 * This is called when background effects settings change
	 */
	const applyBackgroundEffectsToLocalStream = async () => {
		const bgEffects = getBackgroundEffectsFromStorage();
		const wantsEffects = bgEffects.anyEnabled;
		const localStream = meetingState.localStream.value;
		const hasLiveVideoTrack =
			!!localStream &&
			localStream.getVideoTracks().some((track) => track.readyState === "live");

		if (!localStream || !hasLiveVideoTrack) {
			shouldApplyBackgroundEffectsWhenVideoAvailable = wantsEffects;
			if (backgroundSession) {
				backgroundSession.cleanup?.();
				backgroundSession = null;
			}
			if (processedStream.value) {
				stopProcessing();
				processedStream.value = null;
			}
			return;
		}

		shouldApplyBackgroundEffectsWhenVideoAvailable = false;

		try {
			if (backgroundSession) {
				await backgroundSession.updateOptions({
					blurIntensity: bgEffects.blurIntensity,
					backgroundBlurEnabled: bgEffects.blurEnabled,
					backgroundImageEnabled: bgEffects.imageEnabled,
					selectedBackgroundImage: bgEffects.selectedImage,
				});
				return;
			}

			const result = await applyBackgroundEffects(localStream, {
				blurIntensity: bgEffects.blurIntensity,
				backgroundBlurEnabled: bgEffects.blurEnabled,
				backgroundImageEnabled: bgEffects.imageEnabled,
				selectedBackgroundImage: bgEffects.selectedImage,
			});
			backgroundSession = result;
			processedStream.value = result.stream;
			await replacePublishedVideoTrack(result.stream, "background-enabled");
		} catch (error) {
			console.warn(
				"Failed to apply background effects to local stream:",
				error,
			);
			// Fallback to original stream
			await replacePublishedVideoTrack(localStream, "background-error");
			if (backgroundSession) {
				backgroundSession.cleanup?.();
				backgroundSession = null;
			}
			if (processedStream.value) {
				processedStream.value = null;
				stopProcessing();
			}
		}
	};
	// API Resources
	const joinMeetingAPI = createResource({
		url: "sae.api.meeting.join_meeting",
		method: "POST",
		makeParams: () => ({ meeting_id: meetingId }),
	});

	// ==================== CAMERA & MEDIA SETUP ====================

	/**
	 * Ensure devices are enumerated and return a valid device ID for the given type
	 * Falls back to default device if stored device is not available
	 */
	const getValidDeviceId = async (storedDeviceId, deviceType) => {
		if (!storedDeviceId) return null;

		try {
			await deviceManager.enumerateDevices({ video: false, audio: false });

			if (deviceManager.isDeviceAvailable(storedDeviceId, deviceType)) {
				return storedDeviceId;
			}

			const defaultDevice = deviceManager.getDefaultDevice(deviceType);
			if (defaultDevice) {
				if (deviceType === "camera") {
					setSelectedCameraId(defaultDevice.deviceId);
				} else if (deviceType === "microphone") {
					setSelectedMicId(defaultDevice.deviceId);
				} else if (deviceType === "speaker") {
					setSelectedSpeakerId(defaultDevice.deviceId);
				}

				return defaultDevice.deviceId;
			}

			if (deviceType === "camera") {
				setSelectedCameraId("");
			} else if (deviceType === "microphone") {
				setSelectedMicId("");
			} else if (deviceType === "speaker") {
				setSelectedSpeakerId("");
			}
			return null;
		} catch (error) {
			console.warn(
				`Could not validate ${deviceType} device availability:`,
				error,
			);
			return storedDeviceId;
		}
	};

	const buildMediaConstraints = async (videoEnabled, audioEnabled) => {
		const constraints = {};
		const deviceIds = {};

		if (videoEnabled) {
			constraints.video = {
				width: { ideal: 1280, min: 960 },
				height: { ideal: 720, min: 540 },
				frameRate: { ideal: 30, max: 30 },
			};

			const validCameraId = await getValidDeviceId(
				selectedCameraId.value,
				"camera",
			);
			if (validCameraId) {
				constraints.video.deviceId = { exact: validCameraId };
				deviceIds.camera = validCameraId;
			}
			// If no valid device ID, let browser use its default
		}

		if (audioEnabled) {
			constraints.audio = {};

			const validMicId = await getValidDeviceId(
				selectedMicId.value,
				"microphone",
			);
			if (validMicId) {
				constraints.audio.deviceId = { exact: validMicId };
				deviceIds.microphone = validMicId;
			}
			// If no valid device ID, let browser use its default
		}

		return { constraints, deviceIds };
	};

	/**
	 * Apply speaker device to all audio elements
	 */
	const applySpeakerDevice = async () => {
		try {
			const validSpeakerId = await getValidDeviceId(
				selectedSpeakerId.value,
				"speaker",
			);

			if (validSpeakerId && sfuManager.value?.videoManager) {
				const audioElements = sfuManager.value.videoManager.audioElements;

				for (const [participantId, audioElement] of audioElements) {
					try {
						await audioElement.setSinkId(validSpeakerId);
					} catch (error) {
						console.warn(`Failed to set speaker for ${participantId}:`, error);
					}
				}
			}
		} catch (error) {
			console.warn("Failed to apply speaker device:", error);
		}
	};

	/**
	 * Initialize camera and media devices
	 */
	const initializeCamera = async () => {
		try {
			meetingState.setMediaState(prefMicEnabled.value, prefCameraEnabled.value);

			if (meetingState.isCameraOn.value || meetingState.isMicOn.value) {
				const { constraints, deviceIds } = await buildMediaConstraints(
					meetingState.isCameraOn.value,
					meetingState.isMicOn.value,
				);

				const stream = await navigator.mediaDevices.getUserMedia(constraints);
				meetingState.localStream.value = stream;
				// Clear any stale connection error on successful media acquisition
				if (meetingState.connectionError.value) {
					meetingState.connectionError.value = null;
				}
				if (meetingState.isCameraOn.value) {
					meetingState.cameraPermissionGranted.value = true;

					// Always apply background effects to avoid
					// recreation issues when effects are enabled from no effects
					await applyBackgroundEffectsToLocalStream();
				}
				if (meetingState.isMicOn.value) {
					meetingState.microphonePermissionGranted.value = true;
				}
				console.log("Camera initialized successfully");
			}
		} catch (error) {
			console.error("Failed to initialize camera:", error);

			meetingState.setMediaState(false, false);
			setMicEnabled(false);
			setCameraEnabled(false);

			const isPermissionError =
				error.name === "NotAllowedError" ||
				error.name === "PermissionDeniedError";
			toast.warning(
				isPermissionError
					? "Media access denied. Enable permissions in browser settings."
					: "Media access failed. You can join without media.",
			);
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
						const { constraints, deviceIds } = await buildMediaConstraints(
							meetingState.isCameraOn.value,
							enable,
						);
						stream = await navigator.mediaDevices.getUserMedia(constraints);
						meetingState.localStream.value = stream;
						meetingState.cameraPermissionGranted.value = true;
						meetingState.microphonePermissionGranted.value = true;
					} catch (err) {
						console.error("Failed to get microphone stream:", err);
						const isPermissionError =
							err.name === "NotAllowedError" ||
							err.name === "PermissionDeniedError";
						toast.error(
							isPermissionError
								? "Microphone access denied. Enable in browser settings."
								: "Failed to access microphone",
						);
						return;
					}
				} else {
					// Existing stream: ensure we have an audio track
					const hasAudio = stream.getAudioTracks().length > 0;
					if (!hasAudio) {
						try {
							const { constraints, deviceIds } = await buildMediaConstraints(
								false,
								true,
							);
							const audioOnly =
								await navigator.mediaDevices.getUserMedia(constraints);
							const newTrack = audioOnly.getAudioTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
								meetingState.microphonePermissionGranted.value = true;
							}
						} catch (err) {
							console.error("Failed to add audio track:", err);
							const isPermissionError =
								err.name === "NotAllowedError" ||
								err.name === "PermissionDeniedError";
							toast.error(
								isPermissionError
									? "Microphone access denied. Enable in browser settings."
									: "Could not enable microphone",
							);
							return;
						}
					} else {
						// Ensure existing track is enabled, or get new if stopped
						const at = stream.getAudioTracks()[0];
						if (at.readyState === "ended") {
							// Track was stopped, get a new one
							try {
								const { constraints, deviceIds } = await buildMediaConstraints(
									false,
									true,
								);
								const audioOnly =
									await navigator.mediaDevices.getUserMedia(constraints);
								const newTrack = audioOnly.getAudioTracks()[0];
								if (newTrack) {
									stream.removeTrack(at);
									stream.addTrack(newTrack);
									meetingState.microphonePermissionGranted.value = true;
								}
							} catch (err) {
								console.error("Failed to replace audio track:", err);
								const isPermissionError =
									err.name === "NotAllowedError" ||
									err.name === "PermissionDeniedError";
								toast.error(
									isPermissionError
										? "Microphone access denied. Enable in browser settings."
										: "Could not enable microphone",
								);
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
						const currentTrack = mh.audioProducer.track;
						if (currentTrack && currentTrack.readyState === "ended") {
							await mh.audioProducer.replaceTrack({ track });
						} else {
							mh.audioProducer.resume?.();
							if (track) track.enabled = true;
						}
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
					mh.audioProducer.close?.();

					const sfuClient = getSFUClient();
					if (sfuClient.isConnected()) {
						sfuClient.closeProducer(mh.audioProducer.id).catch(() => {});
					}

					mh.audioProducer = null;
				}
			}

			meetingState.isMicOn.value = enable;
			setMicEnabled(enable);

			if (
				enable &&
				meetingState.raisedHands.value?.[getSFUClient().getUserId()]
			) {
				try {
					await getSFUClient().sendRaiseHand(false);
					const currentHands = meetingState.raisedHands.value || {};
					const newHands = { ...currentHands };
					delete newHands[getSFUClient().getUserId()];
					meetingState.raisedHands.value = newHands;
				} catch (error) {
					console.error("Failed to lower hand on unmute:", error);
				}
			}

			// Send media control update (server expects string actions as well)
			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				try {
					sfuClient.sendMediaControl(enable ? "unmute" : "mute");
				} catch (_) {
					sfuClient.sendMediaControl({ type: "audio", enabled: enable });
				}
			}

			console.log(`Microphone ${enable ? "enabled" : "disabled"}`);
		} catch (error) {
			console.error("Failed to toggle microphone:", error);
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
						const { constraints, deviceIds } = await buildMediaConstraints(
							true,
							meetingState.isMicOn.value,
						);
						stream = await navigator.mediaDevices.getUserMedia(constraints);
						meetingState.localStream.value = stream;
						meetingState.cameraPermissionGranted.value = true;
						if (meetingState.isMicOn.value) {
							meetingState.microphonePermissionGranted.value = true;
						}
					} catch (err) {
						console.error("Failed to get camera stream:", err);
						const isPermissionError =
							err.name === "NotAllowedError" ||
							err.name === "PermissionDeniedError";
						toast.error(
							isPermissionError
								? "Camera access denied. Enable in browser settings."
								: "Failed to access camera",
						);
						return;
					}
				} else {
					// Existing stream: ensure we have a video track
					const hasVideo = stream.getVideoTracks().length > 0;
					if (!hasVideo) {
						try {
							const { constraints, deviceIds } = await buildMediaConstraints(
								true,
								false,
							);
							const videoOnly =
								await navigator.mediaDevices.getUserMedia(constraints);
							const newTrack = videoOnly.getVideoTracks()[0];
							if (newTrack) {
								stream.addTrack(newTrack);
								meetingState.cameraPermissionGranted.value = true;
								// Force video element update
								if (meetingState.localVideo) {
									const videoTracks = stream.getVideoTracks();
									if (videoTracks.length > 0) {
										meetingState.localVideo.srcObject = new MediaStream(
											videoTracks,
										);
									}
								}
							}
						} catch (err) {
							console.error("Failed to add video track:", err);
							const isPermissionError =
								err.name === "NotAllowedError" ||
								err.name === "PermissionDeniedError";
							toast.error(
								isPermissionError
									? "Camera access denied. Enable in browser settings."
									: "Could not enable camera",
							);
							return;
						}
					} else {
						// Ensure existing track is enabled, or get new if stopped
						const vt = stream.getVideoTracks()[0];
						if (vt.readyState === "ended") {
							// Track was stopped, get a new one
							try {
								const { constraints, deviceIds } = await buildMediaConstraints(
									true,
									false,
								);
								const videoOnly =
									await navigator.mediaDevices.getUserMedia(constraints);
								const newTrack = videoOnly.getVideoTracks()[0];
								if (newTrack) {
									stream.removeTrack(vt);
									stream.addTrack(newTrack);
									meetingState.cameraPermissionGranted.value = true;
									if (meetingState.localVideo) {
										const videoTracks = stream.getVideoTracks();
										if (videoTracks.length > 0) {
											meetingState.localVideo.srcObject = new MediaStream(
												videoTracks,
											);
										}
									}
								}
							} catch (err) {
								console.error("Failed to replace video track:", err);
								const isPermissionError =
									err.name === "NotAllowedError" ||
									err.name === "PermissionDeniedError";
								toast.error(
									isPermissionError
										? "Camera access denied. Enable in browser settings."
										: "Could not enable camera",
								);
								return;
							}
						} else {
							vt.enabled = true;
						}
					}
				}

				// Apply background effects to local stream for preview if enabled
				const bgEffects = getBackgroundEffectsFromStorage();
				if (
					bgEffects.anyEnabled ||
					shouldApplyBackgroundEffectsWhenVideoAvailable
				) {
					await applyBackgroundEffectsToLocalStream();
				}

				// Publish or resume producer
				const track = stream.getVideoTracks()[0];
				if (mh?.videoProducer) {
					const trackToReplace = processedStream.value
						? processedStream.value.getVideoTracks()[0]
						: track;
					try {
						await mh.videoProducer.replaceTrack({ track: trackToReplace });
					} catch (error) {
						console.warn("Failed to replace video track:", error);
					}
				} else if (track && sfuManager.value?.transportManager) {
					// use processed stream if available
					// since background effects may be applied
					const trackToPublish = processedStream.value
						? processedStream.value.getVideoTracks()[0]
						: track;

					const producer =
						await sfuManager.value.transportManager.createProducer(
							trackToPublish,
							{
								type: "camera",
							},
						);
					mh?.setProducers({ videoProducer: producer });
				}
			} else {
				// Turning camera OFF
				if (stream) {
					const vt = stream.getVideoTracks()[0];
					if (vt) {
						vt.stop();
						stream.removeTrack(vt);
					}
				}

				// Clean up background effects session and processed stream
				if (backgroundSession) {
					backgroundSession.cleanup?.();
					backgroundSession = null;
				}
				if (processedStream.value) {
					stopProcessing();
					processedStream.value = null;
				}

				if (mh?.videoProducer) {
					mh.videoProducer.close?.();

					const sfuClient = getSFUClient();
					if (sfuClient.isConnected()) {
						sfuClient.closeProducer(mh.videoProducer.id).catch(() => {});
					}

					mh.videoProducer = null;
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

			console.log(`Camera ${enable ? "enabled" : "disabled"}`);
		} catch (error) {
			console.error("Failed to toggle camera:", error);
			toast.error("Failed to toggle camera");
		}
	};

	const toggleScreenShare = async () => {
		try {
			if (meetingState.isScreenSharing.value) {
				// Stop screen sharing
				if (sfuManager.value?.mediaHandler) {
					// If there is a screen producer, close it (local producer cleanup)
					const sp = sfuManager.value.mediaHandler.screenProducer;
					if (sp?.id) {
						sp.close?.();
						// Ask SFU to close the producer so it notifies other peers
						const sfuClient = getSFUClient();
						if (sfuClient.isConnected()) {
							sfuClient.closeProducer(sp.id);
						}
					}
					// Local media handler track cleanup
					sfuManager.value.mediaHandler.stopScreenShare();
				}

				// Proactively stop all local display tracks so browser indicator clears
				const tracks = meetingState.screenShareStream.value?.getTracks?.();
				if (tracks) {
					for (const t of tracks) {
						t.stop();
					}
				}
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
					sfuClient.sendScreenShare("stop_share");
				}
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
					if (sfuManager.value?.mediaHandler) {
						sfuManager.value.mediaHandler.setProducers({
							screenProducer: producer,
						});
					}

					// Ensure audio producer remains active/independent of screen producer
					try {
						const mh = sfuManager.value?.mediaHandler;
						// If there's an audioProducer and it's paused, resume it
						if (mh?.audioProducer?.paused) {
							try {
								mh.audioProducer.resume?.();
							} catch (_) {
								console.warn(
									"Failed to resume audioProducer after starting screen share",
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
										"Re-published microphone producer after starting screen share",
									);
								} catch (err) {
									console.warn(
										"Failed to publish mic producer after starting screen share",
										err,
									);
								}
							}
						}
					} catch (err) {
						console.warn(
							"Error ensuring audio producer after screen share start:",
							err,
						);
					}
				} catch (pubErr) {
					console.error("Failed to publish screen share producer:", pubErr);
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
						toggleScreenShare();
					}
				});

				const sfuClient = getSFUClient();
				if (sfuClient.isConnected()) {
					sfuClient.sendScreenShare("start_share", {
						startedAt: meetingState.localScreenShareStartedAt.value,
					});
				}

				console.log("Screen sharing started (published)");
			}
		} catch (error) {
			if (error.name === "NotAllowedError") {
				console.log("User cancelled screen share");
			} else {
				console.error("Screen share failed:", error);
				toast.error("Failed to start screen sharing");
			}
		}
	};

	// ==================== MEETING MANAGEMENT ====================

	/**
	 * Join meeting room
	 */
	const joinMeetingRoom = async (guestName = null) => {
		if (joiningInProgress.value) {
			return;
		}

		try {
			joiningInProgress.value = true;
			meetingState.isConnecting.value = true;
			meetingState.connectionError.value = null;

			let joinResult;

			if (guestName) {
				const guestId =
					meetingState.guestId.value || sessionStorage.getItem("guest_id");

				if (!guestId) {
					throw new Error("Guest session not found. Please try joining again.");
				}

				// Always call the API to get current status, especially for waiting guests
				const apiResult = await frappeRequest({
					url: "sae.api.meeting.join_meeting_as_guest",
					params: {
						meeting_id: meetingId,
						guest_name: guestName,
						guest_id: guestId,
					},
				});

				if (!apiResult.success) {
					throw new Error(apiResult.error || "Failed to join as guest");
				}

				joinResult = apiResult;
			} else {
				meetingState.guestAuthToken.value = null;
				meetingState.guestSfuUrl.value = null;
				meetingState.guestSfuPort.value = null;
				sessionStorage.removeItem("guest_auth_token");
				sessionStorage.removeItem("guest_id");
				sessionStorage.removeItem("guest_name");
				sessionStorage.removeItem("guest_meeting_id");
				sessionStorage.removeItem("guest_status");
				sessionStorage.removeItem("guest_sfu_url");
				sessionStorage.removeItem("guest_sfu_port");

				const response = await joinMeetingAPI.fetch();

				if (!response.success) {
					throw new Error(response.error || "Failed to join meeting");
				}

				joinResult = response;
			}

			if (guestName && joinResult.guest_id) {
				sessionStorage.setItem("guest_id", joinResult.guest_id);
				sessionStorage.setItem("guest_name", guestName);
				sessionStorage.setItem("guest_meeting_id", meetingId);
				sessionStorage.setItem("guest_status", joinResult.status);

				meetingState.guestId.value = joinResult.guest_id;
				meetingState.guestAuthToken.value = joinResult.auth_token || null;
				meetingState.guestSfuUrl.value = joinResult.sfu_url || null;
				meetingState.guestSfuPort.value = joinResult.sfu_port || null;
			}

			if (joinResult.status === "waiting_for_approval") {
				meetingState.isWaitingForApproval.value = true;
				meetingState.isInPreview.value = false;
				meetingState.isConnecting.value = false;

				if (guestName && joinResult.guest_id) {
					meetingState.guestAuthToken.value = null;
					meetingState.guestSfuUrl.value = joinResult.sfu_url || null;
					meetingState.guestSfuPort.value = joinResult.sfu_port || null;
				}

				if (guestName) {
					setupGuestApprovalListener(guestName);
				} else {
					setupFrappeRealtimeEventListeners();
				}

				return;
			}

			// Initialize SFU connection
			console.log("Starting SFU connection setup...");
			await setupSFUConnection(guestName, joinResult?.is_host || false);

			setupFrappeRealtimeEventListeners();
			console.log("Updating meeting state after successful SFU setup...");
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

			console.log("Successfully joined meeting", {
				isInPreview: meetingState.isInPreview.value,
				isConnecting: meetingState.isConnecting.value,
				isWaitingForApproval: meetingState.isWaitingForApproval.value,
			});
		} catch (error) {
			console.error("Failed to join meeting:", error);
			meetingState.connectionError.value = error.messages.length
				? error.messages.join(", ")
				: "Failed to join meeting";
			meetingState.isConnecting.value = false;
		} finally {
			joiningInProgress.value = false;
		}
	};

	/**
	 * Setup SFU connection and media publishing
	 */
	const setupSFUConnection = async (guestName = null, isHost = false) => {
		if (meetingState.isSetupComplete.value) {
			console.log("SFU setup already complete");
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

			if (!guestName) {
				setupFrappeRealtimeEventListeners();
			}

			// Connect to SFU
			await sfuManager.value.connect(meetingState.guestAuthToken.value);
			meetingState.codecStrategy.value =
				getSFUClient().getCodecStrategy() || "auto";

			// Join the room with user details and initial media states
			let userData;
			if (guestName) {
				userData = {
					name: guestName,
					userId: meetingState.guestId.value || "",
					avatar: null,
					is_guest: true,
					isHost: false,
				};
			} else {
				userData = {
					name:
						meetingState.currentUser.value?.full_name ||
						meetingState.currentUser.value?.name ||
						"You",
					userId: meetingState.currentUser.value?.user_id || "",
					avatar: meetingState.currentUser.value?.avatar || "",
					is_guest: false,
					isHost: isHost,
				};
			}

			await sfuManager.value.joinRoom(userData, {
				audio_enabled: meetingState.isMicOn.value,
				video_enabled: meetingState.isCameraOn.value,
			});

			// Now initialize device and create transports
			await sfuManager.value.initializeDevice();
			await sfuManager.value.createReceiveTransport();

			// Publish local media if available
			if (meetingState.localStream.value) {
				try {
					// Create a combined stream with:
					// - Video from processedStream (if background effects) or localStream
					// - Audio always from localStream (there's no audio in processedStream)
					const videoTracks = processedStream.value
						? processedStream.value.getVideoTracks()
						: meetingState.localStream.value.getVideoTracks();
					const audioTracks = meetingState.localStream.value.getAudioTracks();

					const streamToPublish = new MediaStream([
						...videoTracks,
						...audioTracks,
					]);

					await sfuManager.value.publishMedia(streamToPublish, {
						publishVideo: meetingState.isCameraOn.value,
						publishAudio: meetingState.isMicOn.value,
					});
					console.log("Media publishing completed");
				} catch (error) {
					console.warn(
						"Media publishing failed, continuing without media:",
						error.message,
					);
					// Continue with meeting setup even if media publishing fails
				}
			}

			// Setup existing participants
			await sfuManager.value.setupExistingParticipants();

			meetingState.isSetupComplete.value = true;
			console.log("SFU connection setup complete");

			if (!guestName) {
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
				url: "sae.api.meeting.get_waiting_room",
				params: { meeting_id: meetingId },
			});

			if (result?.success && result?.waiting_users) {
				const transformedUsers = result.waiting_users.map((user) => ({
					userId: user.user_id,
					name: user.full_name || user.user_id,
					avatar: user.user_image,
					isGuest: user.is_guest || false,
				}));

				meetingState.lobbyUsers.value = transformedUsers;

				if (notifiedLobbyUsers) {
					for (const user of transformedUsers) {
						notifiedLobbyUsers.value.add(user.userId);
					}
				}
			}
		} catch (error) {
			console.error("Failed to fetch waiting room users:", error);
		}
	};

	/**
	 * Setup realtime listener for guest approval/rejection
	 */
	const setupGuestApprovalListener = (guestName) => {
		const guestId = sessionStorage.getItem("guest_id");
		if (!guestId) {
			console.error("No guest_id found for realtime listener");
			return;
		}

		if (!socket) {
			console.error("Socket not available for guest approval listener");
			return;
		}

		// Subscribe to guest-specific room
		socket.emit("guest_subscribe", guestId);

		// Listen for guest approval/rejection events
		socket.on("sae:guest_join_approved", handleGuestApproved);
		socket.on("sae:guest_join_rejected", handleGuestRejected);

		async function handleGuestApproved(data) {
			if (data.guest_id !== guestId || data.meeting_id !== meetingId) {
				return;
			}

			console.log("Guest approved! Fetching connection details...", data);
			stopGuestApprovalListener();

			meetingState.isWaitingForApproval.value = false;

			try {
				const guestName = sessionStorage.getItem("guest_name") || "Guest";
				const response = await frappeRequest({
					url: "sae.api.meeting.get_approved_guest_connection_details",
					params: {
						meeting_id: meetingId,
						guest_id: guestId,
					},
				});

				if (
					response.success &&
					response.status === "joined" &&
					response.auth_token
				) {
					meetingState.guestAuthToken.value = response.auth_token;
					meetingState.guestSfuUrl.value = response.sfu_url || null;
					meetingState.guestSfuPort.value = response.sfu_port || null;

					await setupSFUConnection(guestName, false);

					meetingState.isInPreview.value = false;
					meetingState.isConnecting.value = false;
				} else {
					console.error(
						"Failed to get connection details after approval:",
						response,
					);
					meetingState.connectionError.value =
						"Failed to get authorization token after approval";
				}
			} catch (error) {
				console.error(
					"Error fetching connection details after approval:",
					error,
				);
				meetingState.connectionError.value = "Failed to connect after approval";
			}
		}

		function handleGuestRejected(data) {
			if (data.guest_id !== guestId || data.meeting_id !== meetingId) {
				return;
			}

			console.log("Guest rejected!", data);
			stopGuestApprovalListener();

			meetingState.isJoinRequestRejected.value = true;
			meetingState.isWaitingForApproval.value = false;

			toast.error("Your join request was denied by the meeting host");
		}
	};

	const stopGuestApprovalListener = () => {
		if (!socket) return;

		const guestId = sessionStorage.getItem("guest_id");

		// Unsubscribe from guest room
		if (guestId) {
			socket.emit("guest_unsubscribe", guestId);
		}

		socket.off("sae:guest_join_approved");
		socket.off("sae:guest_join_rejected");
	};

	const setupFrappeRealtimeEventListeners = () => {
		if (realtimeListenersSetup.value) {
			return;
		}

		if (!socket) {
			console.warn("Socket not available for realtime events");
			return;
		}

		socket.on("meeting_join_request", (data) => {
			if (data.meeting === meetingId) {
				if (!data.user) {
					return;
				}

				const userData = {
					userId: data.user,
					name: data.user_name || data.user,
					avatar: data.user_image,
					requested_at: new Date().toISOString(),
				};

				const currentLobbyUsers = meetingState.lobbyUsers.value || [];
				const userExists = currentLobbyUsers.some(
					(u) => u.userId === userData.userId,
				);

				if (!userExists) {
					meetingState.lobbyUsers.value = [...currentLobbyUsers, userData];
				}

				audioNotificationManager.playJoinRequestNotification();
			}
		});

		socket.on("meeting_join_approved", async (data) => {
			const currentUserId = meetingState.currentUser.value?.user_id;

			if (data.meeting === meetingId && data.user === currentUserId) {
				console.log("Join request approved, getting SFU token...");

				meetingState.isWaitingForApproval.value = false;

				try {
					const sfuResult = await frappeRequest({
						url: "sae.api.meeting.get_sfu_connection_details",
						params: {
							meeting_id: meetingId,
						},
					});

					if (sfuResult?.success) {
						await setupSFUConnection(null, sfuResult.is_host);
						meetingState.isInPreview.value = false;
					} else {
						console.error("Failed to get SFU connection:", sfuResult);
						meetingState.isJoinRequestRejected.value = true;
						toast.error("Failed to join meeting after approval");
					}
				} catch (error) {
					console.error("Error after approval:", error);
					meetingState.connectionError.value = error.messages.length
						? error.messages.join(", ")
						: "Failed to join meeting after approval";
					toast.error("Failed to join meeting after approval");
				}
			}
		});

		socket.on("meeting_join_rejected", (data) => {
			const currentUserId = meetingState.currentUser.value?.user_id;

			if (data.meeting === meetingId && data.user === currentUserId) {
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
				const participantName = participant?.user_name || participant?.user_id;
				const participantId = participant.participantId || participant.user_id;
				const currentUserId = meetingState.currentUser.value?.user_id;

				if (
					!participantId ||
					// Don't add current user as a remote participant
					participantId === currentUserId ||
					participant?.user_id === currentUserId
				) {
					return;
				}

				meetingState.addParticipant(participant);
				console.log("Participant joined:", participant);

				audioNotificationManager.playJoinNotification(
					participant.participantId,
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
								src: participant.avatar,
								class: "rounded-full",
							})
						: h(LucideUserIcon, {
								class: "text-white",
							}),
					duration: 3,
				});
			},

			onParticipantLeft: ({ participantId }) => {
				const participant = meetingState.participants.value[participantId];
				const participantName = participant?.user_name || participantId;

				meetingState.removeParticipant(participantId);
				console.log("Participant left:", participantId);

				if (participantId === meetingState.currentUser.value?.user_id) {
					return;
				}

				const LucideUserIcon = defineAsyncComponent(
					() => import("~icons/lucide/user"),
				);

				toast.create({
					message: `${participantName} left the meeting`,
					icon: participant?.avatar
						? h("img", {
								src: participant.avatar,
								class: "rounded-full",
							})
						: h(LucideUserIcon, {
								class: "text-white",
							}),
					duration: 3,
				});
			},

			onParticipantUpdated: (participantId, participant, updates) => {
				// Propagate updates to meeting state so UI reacts
				if (participantId) {
					meetingState.updateParticipant(participantId, updates || {});
				}
				console.log("Participant updated:", participantId, updates);
			},
			onScreenShareStarted: (data) => {
				const pid = data.participantId;
				if (!pid) return;
				console.log("onScreenShareStarted raw payload", {
					participantId: pid,
					hasStream: data.stream instanceof MediaStream,
					consumerId: data.consumer?.id,
					consumerKind: data.consumer?.kind,
					consumerIsScreen:
						data.consumer?.isScreen ||
						data.consumer?.appData?.type === "screen",
				});
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
						console.warn("Failed to store screen share stream:", err);
					}
				}
				console.log("Screen share started:", {
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
				console.log("Screen share stopped:", data);
			},
			onActiveSpeakerChanged: (participantIds) => {
				if (activeSpeakerTimeout.value) {
					clearTimeout(activeSpeakerTimeout.value);
					activeSpeakerTimeout.value = null;
				}

				meetingState.activeSpeakerIds.value = participantIds;

				if (participantIds.length > 0) {
					activeSpeakerTimeout.value = setTimeout(() => {
						meetingState.activeSpeakerIds.value = [];
						activeSpeakerTimeout.value = null;
					}, 1000);
				}
			},
			onHostMutedYou: () => {
				if (meetingState.isMicOn.value) {
					toggleMicrophone();
				}
			},
			onHostKickedYou: (data) => {
				toast.error("You have been removed from the meeting by the host");

				setTimeout(() => {
					endCall();
				}, 1000);
			},
		};
	};

	/**
	 * End call and cleanup
	 */
	const endCall = async () => {
		try {
			stopGuestApprovalListener();

			if (activeSpeakerTimeout.value) {
				clearTimeout(activeSpeakerTimeout.value);
				activeSpeakerTimeout.value = null;
			}

			// leave sound for local user only
			audioNotificationManager.playLeaveNotification(true);

			// Cleanup SFU manager
			if (sfuManager.value) {
				sfuManager.value.cleanup();
			}

			// Reset SFU manager instance
			resetSFUMeetingManager();

			// Navigate to home
			router.push({ name: "Home" });

			console.log("Call ended");
		} catch (error) {
			console.error("Error ending call:", error);
			// Still navigate away even if cleanup fails
			router.push({ name: "Home" });
		}
	};

	// ==================== WAITING ROOM MANAGEMENT ====================

	/**
	 * Approve user join request
	 */
	const approveUser = async (userId) => {
		try {
			const result = await frappeRequest({
				url: "sae.api.meeting.approve_join_request",
				params: {
					meeting_id: meetingId,
					user_id: userId,
				},
			});

			if (result?.success) {
				meetingState.lobbyUsers.value = (
					meetingState.lobbyUsers.value || []
				).filter((u) => u.userId !== userId);
			} else {
				console.error("Failed to approve user:", result);
				toast.error("Failed to approve user");
			}
		} catch (error) {
			console.error("Failed to approve user:", error);
			toast.error("Failed to approve user");
		}
	};

	/**
	 * Reject user join request
	 */
	const rejectUser = async (userId) => {
		try {
			const result = await frappeRequest({
				url: "sae.api.meeting.reject_join_request",
				params: {
					meeting_id: meetingId,
					user_id: userId,
				},
			});

			if (result?.success) {
				meetingState.lobbyUsers.value = (
					meetingState.lobbyUsers.value || []
				).filter((u) => u.userId !== userId);
			} else {
				console.error("Failed to reject user:", result);
				toast.error("Failed to reject user");
			}
		} catch (error) {
			console.error("Failed to reject user:", error);
			toast.error("Failed to reject user");
		}
	};

	// ==================== VIDEO ELEMENT MANAGEMENT ====================

	/**
	 * Set local video element reference
	 */
	function setLocalVideoRef(el) {
		localVideo.value = el;
		if (el && meetingState.localStream.value) {
			// Use processed stream if background effects are enabled, otherwise use original
			const streamToUse =
				processedStream.value || meetingState.localStream.value;

			// we are tracking the stream ID to detect real changes
			// to prevent flashing when re-rendering
			const currentStreamId = streamToUse.id;
			const trackedStreamId = el.dataset.sourceStreamId;

			if (!el.srcObject || trackedStreamId !== currentStreamId) {
				// only attach video tracks since it's local
				const videoTracks = streamToUse.getVideoTracks();
				if (videoTracks.length > 0) {
					el.srcObject = new MediaStream(videoTracks);
					el.dataset.sourceStreamId = currentStreamId;
				} else {
					el.srcObject = streamToUse;
					el.dataset.sourceStreamId = currentStreamId;
				}
				// muted since it's local
				el.muted = true;
			}
		}
		// Expose on meetingState for external watchers that auto-play
		meetingState.localVideo = el;
	}

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
				console.warn("Failed to access screenShareStreams store", err);
			}
			// If no stream yet, registration will allow onScreenShareStarted to attach later
			if (stream instanceof MediaStream) {
				// we are comparing the stream ID to detect real changes
				// to prevent flashing when re-rendering
				const currentStreamId = stream.id;
				const existingStreamId = el.srcObject?.id;

				if (!el.srcObject || existingStreamId !== currentStreamId) {
					el.srcObject = stream;
					el.play?.().catch(() => {});
				}
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
				// Skip adding our own messages to avoid duplicates
				if (data.fromUser === meetingState.currentUser.value?.user_id) {
					return;
				}

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

					audioNotificationManager.playChatNotification();
				}
			});
		} catch (error) {
			console.error("Failed to setup chat events:", error);
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
			console.error("Failed to send chat message:", error);
			toast.error("Failed to send message");
		}
	};

	// ==================== REACTIONS ===================

	const showReactionForUser = (userId, emoji, duration = 5000) => {
		const now = Date.now();
		const expiresAt = now + duration;

		const existing = meetingState.reactions.value[userId];
		if (existing?.timeoutId) {
			clearTimeout(existing.timeoutId);
		}

		const timeoutId = window.setTimeout(() => {
			if (meetingState.reactions.value[userId]) {
				delete meetingState.reactions.value[userId];
			}
		}, duration);

		meetingState.reactions.value = {
			...meetingState.reactions.value,
			[userId]: { emoji, expiresAt, timeoutId },
		};
	};

	const setupReactionEvents = () => {
		try {
			const sfuClient = getSFUClient();

			sfuClient.on("reaction:message", (data) => {
				const userId = data.fromUser;
				const emoji = data.message || data.reaction;
				const duration = data.duration || 5000;

				if (userId && emoji) {
					showReactionForUser(userId, emoji, duration);
				}
			});
		} catch (error) {
			console.error("Failed to setup reaction events:", error);
		}
	};

	const onSendReaction = (reactionType) => {
		try {
			const userId = meetingState.currentUser.value?.user_id;
			if (userId) {
				showReactionForUser(userId, reactionType, 5000);
			}

			const reaction = {
				id: Date.now() + Math.random(),
				user_id: meetingState.currentUser.value?.user_id,
				user_name:
					meetingState.currentUser.value?.full_name ||
					meetingState.currentUser.value?.name ||
					meetingState.currentUser.value?.user_id,
				reaction: reactionType,
				timestamp: new Date().toISOString(),
			};

			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				sfuClient.sendReaction(reactionType, {
					clientId: meetingState.currentUser.value?.user_id,
				});
			}
		} catch (error) {
			console.error("Failed to send reaction message:", error);
		}
	};

	/**
	 * Setup raise hand events
	 */
	const setupRaiseHandEvents = () => {
		try {
			const sfuClient = getSFUClient();

			sfuClient.on("hand_raised", (data) => {
				const participantId = data.participantId;
				const raised = data.raised;

				const currentHands = meetingState.raisedHands.value || {};
				const newHands = { ...currentHands };

				if (raised) {
					newHands[participantId] = data.timestamp || new Date().toISOString();
				} else {
					delete newHands[participantId];
				}

				meetingState.raisedHands.value = newHands;

				if (raised) {
					audioNotificationManager.playRaiseHandNotification();
				}
			});

			sfuClient.on("existing_raised_hands", (data) => {
				meetingState.raisedHands.value = data.hands || {};
			});
		} catch (error) {
			console.error("Failed to setup raise hand events:", error);
		}
	};

	/**
	 * Toggle raise hand
	 */
	const toggleRaiseHand = async () => {
		try {
			const currentUserId = meetingState.currentUser.value?.user_id;
			if (!currentUserId) return;

			const isCurrentlyRaised =
				!!meetingState.raisedHands.value?.[currentUserId];
			const newRaisedState = !isCurrentlyRaised;

			const currentHands = meetingState.raisedHands.value || {};
			const optimisticHands = { ...currentHands };
			if (newRaisedState) {
				optimisticHands[currentUserId] = new Date().toISOString();
			} else {
				delete optimisticHands[currentUserId];
			}
			meetingState.raisedHands.value = optimisticHands;

			const sfuClient = getSFUClient();
			if (sfuClient.isConnected()) {
				try {
					await sfuClient.sendRaiseHand(newRaisedState);
				} catch (serverError) {
					const currentHands = meetingState.raisedHands.value || {};
					const revertedHands = { ...currentHands };
					if (isCurrentlyRaised) {
						revertedHands[currentUserId] = new Date().toISOString();
					} else {
						delete revertedHands[currentUserId];
					}
					meetingState.raisedHands.value = revertedHands;
					console.error("Failed to toggle raise hand on server:", serverError);
				}
			} else {
				const currentHands = meetingState.raisedHands.value || {};
				const revertedHands = { ...currentHands };
				if (isCurrentlyRaised) {
					revertedHands[currentUserId] = new Date().toISOString();
				} else {
					delete revertedHands[currentUserId];
				}
				meetingState.raisedHands.value = revertedHands;
				console.error("Cannot toggle raise hand: not connected to SFU");
			}
		} catch (error) {
			console.error("Failed to toggle raise hand:", error);
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

	// ==================== NOTIFICATION CONTEXT WATCHERS ====================

	// Watch chat state to update notification context
	watch(
		() => meetingState.isChatOpen.value,
		(isOpen) => {
			notificationContextManager.updateChatState(isOpen);
		},
	);

	// Watch screen sharing state to update notification context
	watch(
		() => meetingState.isScreenSharing.value,
		(isSharing) => {
			notificationContextManager.updateScreenShareState(isSharing);
		},
	);

	// ==================== CLEANUP ====================

	onUnmounted(() => {
		if (activeSpeakerTimeout.value) {
			clearTimeout(activeSpeakerTimeout.value);
			activeSpeakerTimeout.value = null;
		}

		// Cleanup SFU manager (disconnect and free resources)
		sfuManager.value?.cleanup?.();

		// Reset SFU manager instance
		resetSFUMeetingManager();

		// Cleanup background effects
		if (backgroundSession) {
			backgroundSession.cleanup?.();
			backgroundSession = null;
		}
		stopProcessing();

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

	// Watch for processed stream changes and update producer track
	watch(processedStream, async (newStream) => {
		const reason = newStream
			? "processed-stream-change"
			: "processed-stream-removed";
		await replacePublishedVideoTrack(newStream, reason);
	});

	return {
		// Refs
		sfuManager,
		localVideo,
		processedStream,

		// Methods - Media
		initializeCamera,
		toggleMicrophone,
		toggleCamera,
		toggleScreenShare,
		applySpeakerDevice,
		applyBackgroundEffectsToLocalStream,

		// Methods - Meeting
		joinMeetingRoom,
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

		// Methods - Reactions
		setupReactionEvents,
		onSendReaction,
		showReactionForUser,

		// Methods - Raise Hand
		setupRaiseHandEvents,
		toggleRaiseHand,

		// Methods - Keyboard
		handleKeyDown,
	};
}
