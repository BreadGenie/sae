/**
 * SFU Meeting Manager
 * Orchestrates all meeting-related functionality (glue of all modules)
 */

import { ConsumerManager } from "./media/ConsumerManager.js";
import { MediaStreamHandler } from "./media/MediaStreamHandler.js";
import { ParticipantManager } from "./media/ParticipantManager.js";
import { TransportManager } from "./media/TransportManager.js";
import { VideoElementManager } from "./media/VideoElementManager.js";
import { WaitingRoomManager } from "./media/WaitingRoomManager.js";
import { getSFUClient } from "./sfu-client.js";

export class SFUMeetingManager {
	constructor() {
		this.meetingId = null;
		this.currentUser = { value: null };
		this.isConnected = false;
		this.isSetupComplete = false;
		this.initialSyncInProgress = false;
		this.bufferedProducerEvents = [];
		this.processedConsumers = new Set();
		this.isScreenShareActive = false;

		this.mediaHandler = new MediaStreamHandler();
		this.videoManager = new VideoElementManager();
		this.participantManager = new ParticipantManager();
		this.consumerManager = new ConsumerManager();
		this.transportManager = new TransportManager();
		this.waitingRoomManager = new WaitingRoomManager();

		this.sfuClient = null;
		this.eventHandlers = {};
	}

	initialize(options) {
		this.meetingId = options.meetingId;
		this.currentUser = this.ensureRef(options.currentUser);
		this.eventHandlers = options.eventHandlers || {};

		this.setupManagerEventHandlers();
		this.waitingRoomManager.initialize(this.meetingId, this.eventHandlers);
	}

	setupManagerEventHandlers() {
		// Participant manager events
		this.participantManager.setEventHandlers({
			onParticipantAdded: (participant) => {
				if (this.eventHandlers.onParticipantJoined) {
					this.eventHandlers.onParticipantJoined(participant);
				}
			},
			onParticipantRemoved: (participantId, participant) => {
				this.videoManager.removeVideoElement(participantId);
				this.consumerManager.cleanupParticipantConsumers(participantId);
				if (this.eventHandlers.onParticipantLeft) {
					this.eventHandlers.onParticipantLeft({ participantId, participant });
				}
			},
			onParticipantUpdated: (participantId, participant, updates) => {
				if (this.eventHandlers.onParticipantUpdated) {
					this.eventHandlers.onParticipantUpdated(
						participantId,
						participant,
						updates,
					);
				}
			},
		});

		// Consumer manager events
		this.consumerManager.setEventHandlers({
			onConsumerAdded: (consumer) => {
				this.handleNewConsumer(consumer);
			},
			onConsumerRemoved: (consumerId, consumer) => {
				// If this was a screen-share consumer, notify UI to clear screen-share state
				try {
					if (
						consumer &&
						(consumer.isScreen || consumer?.appData?.type === "screen")
					) {
						try {
							this.processedConsumers?.delete?.(consumerId);
						} catch (_) {}
						try {
							this.isScreenShareActive = false;
						} catch (_) {}
						if (this.eventHandlers.onScreenShareStopped) {
							this.eventHandlers.onScreenShareStopped({
								participantId: consumer.participantId,
								consumerId,
							});
						}
					}
				} catch (err) {
					console.warn(
						"⚠️ Error while handling consumer removal for screen-share cleanup",
						err,
					);
				}
			},
		});
	}

	async connect() {
		try {
			this.sfuClient = getSFUClient();
			await this.sfuClient.connect(this.meetingId);
			this.isConnected = true;

			// Initialize transport manager with SFU client
			this.transportManager.initialize(this.sfuClient);

			// Set up SFU event handlers
			this.setupSFUEventHandlers();

			return true;
		} catch (error) {
			console.error("❌ Failed to connect to SFU:", error);
			throw error;
		}
	}

	async initializeDevice() {
		try {
			await this.transportManager.initializeDevice();
			return true;
		} catch (error) {
			console.error("❌ Failed to initialize MediaSoup device:", error);
			throw error;
		}
	}

	async createReceiveTransport() {
		try {
			await this.transportManager.createReceiveTransport();
			return true;
		} catch (error) {
			console.warn("⚠️ Failed to create receive transport:", error);
			return false;
		}
	}

	async publishMedia(localStream, options = {}) {
		const { publishVideo = true, publishAudio = true } = options;
		const results = {};

		try {
			this.mediaHandler.localStream = localStream;

			await this.transportManager.createSendTransport();

			if (publishVideo && localStream) {
				const videoTrack = localStream.getVideoTracks()[0];
				if (videoTrack) {
					try {
						const videoProducer = await this.transportManager.createProducer(
							videoTrack,
							{ type: "camera" },
						);
						results.videoProducer = videoProducer;
						this.mediaHandler.setProducers({ videoProducer });
						console.log("✅ Video published successfully");
					} catch (error) {
						console.warn(
							"⚠️ Failed to publish video, continuing without video:",
							error.message,
						);
					}
				}
			}

			if (publishAudio && localStream) {
				const audioTrack = localStream.getAudioTracks()[0];
				if (audioTrack) {
					try {
						const audioProducer = await this.transportManager.createProducer(
							audioTrack,
							{ type: "microphone" },
						);
						results.audioProducer = audioProducer;
						this.mediaHandler.setProducers({ audioProducer });
						console.log("✅ Audio published successfully");
					} catch (error) {
						console.warn(
							"⚠️ Failed to publish audio, continuing without audio:",
							error.message,
						);
					}
				}
			}
			console.log("📡 Media published successfully");
			return results;
		} catch (error) {
			console.error("❌ Failed to publish media:", error);
			throw error;
		}
	}

	async setupExistingParticipants() {
		try {
			this.initialSyncInProgress = true;

			const participants = await this.sfuClient.getRoomParticipants();

			const normalized = (participants || []).map((p) => {
				const pid = p.user_id || p.id;
				const info = p.info || {};
				return {
					participantId: pid,
					user_id: pid,
					user_name: info.name || info.user_name || pid,
					avatar: info.avatar || null,
					audio_enabled:
						typeof info.audio_enabled === "boolean"
							? info.audio_enabled
							: false,
					video_enabled:
						typeof info.video_enabled === "boolean"
							? info.video_enabled
							: false,
				};
			});

			this.participantManager.syncParticipants(normalized);

			await this.requestExistingProducers();

			await this.flushBufferedProducers();

			this.initialSyncInProgress = false;
		} catch (error) {
			console.error("❌ Error in setupExistingParticipants:", error);
			this.initialSyncInProgress = false;
			throw error;
		}
	}

	async requestExistingProducers() {
		try {
			const existingProducers = await this.sfuClient.getExistingProducers();

			if (existingProducers?.length) {
				console.log(
					`📡 Found ${existingProducers.length} existing producers:`,
					existingProducers.map((p) => ({
						id: p.id,
						participantId: p.participantId || p.user_id || p.userId,
						kind: p.kind,
						isScreen: !!p.isScreen,
					})),
				);

				for (const producerInfo of existingProducers) {
					const pid =
						producerInfo.participantId ||
						producerInfo.user_id ||
						producerInfo.userId;
					const metadata = { isScreen: !!producerInfo.isScreen };
					console.log("📡 Subscribing to existing producer:", {
						producerId: producerInfo.id,
						participantId: pid,
						kind: producerInfo.kind,
						isScreen: !!producerInfo.isScreen,
					});
					await this.subscribeToProducer(producerInfo.id, pid, metadata);
				}
			} else {
				console.log("📡 No existing producers found");
			}

			return existingProducers;
		} catch (error) {
			console.warn("Failed to request existing producers:", error);
			return null;
		}
	}

	async subscribeToProducer(producerId, participantId, metadata = {}) {
		try {
			const consumer = await this.transportManager.createConsumer(
				producerId,
				metadata,
			);

			const enhancedConsumer = this.consumerManager.addConsumer(
				consumer,
				participantId,
			);

			return enhancedConsumer;
		} catch (error) {
			console.error(`❌ Failed to subscribe to producer ${producerId}:`, error);
			throw error;
		}
	}

	async handleNewConsumer(consumer) {
		const { participantId, kind, track, isScreen } = consumer;

		if (this.processedConsumers?.has?.(consumer?.id)) {
			return;
		}

		if (!this.processedConsumers) {
			this.processedConsumers = new Set();
		}
		this.processedConsumers.add(consumer?.id);

		if (!participantId) {
			return;
		}

		if (!this.participantManager.hasParticipant(participantId)) {
			this.participantManager.addParticipant({
				user_id: participantId,
				user_name: participantId, // Will be updated when participant data arrives
			});
		}

		if (isScreen) {
			await this.handleScreenShareConsumer(consumer);
			return;
		}

		if (kind === "video") {
			await this.attachVideoConsumer(participantId, consumer);
		} else if (kind === "audio") {
			await this.attachAudioConsumer(participantId, consumer);
		}
	}

	async attachVideoConsumer(participantId, consumer) {
		try {
			const audioConsumer =
				this.consumerManager.getAudioConsumer(participantId);

			let stream;
			if (audioConsumer) {
				stream = new MediaStream([consumer.track, audioConsumer.track]);
			} else {
				stream = new MediaStream([consumer.track]);
			}

			const attachOk = await this.videoManager.attachStream(
				participantId,
				stream,
				false,
			);

			const participant = this.participantManager.getParticipant(participantId);
			if (participant) {
				if (attachOk) {
					if (!participant.video_enabled) {
						this.participantManager.updateParticipant(participantId, {
							video_enabled: true,
						});
					}
				} else {
					console.warn(
						"📹 Camera stream attached but rendering verification failed for",
						participantId,
					);
				}
			} else {
				console.warn("📹 Participant not found for", participantId);
			}
		} catch (error) {
			console.error(
				`❌ Failed to attach video consumer for ${participantId}:`,
				error,
			);
		}
	}

	async attachAudioConsumer(participantId, consumer) {
		try {
			const videoConsumer =
				this.consumerManager.getVideoConsumer(participantId);

			if (videoConsumer) {
				const combinedStream = this.videoManager.createCombinedStream(
					videoConsumer.track,
					consumer.track,
				);
				await this.videoManager.attachStream(
					participantId,
					combinedStream,
					false,
				);
			} else {
				const audioStream = new MediaStream([consumer.track]);
				await this.videoManager.attachStream(participantId, audioStream, false);
			}
		} catch (error) {
			console.error(
				`❌ Failed to attach audio consumer for ${participantId}:`,
				error,
			);
		}
	}

	async handleScreenShareConsumer(consumer) {
		const { participantId, track } = consumer;

		const allConsumers = this.consumerManager.getAllConsumers();
		const allCameraConsumers = allConsumers.filter(
			(c) => c.kind === "video" && !c.isScreen,
		);

		try {
			// Only re-attach camera consumers once when transitioning to screen share mode
			if (allCameraConsumers.length > 0 && !this.isScreenShareActive) {
				this.isScreenShareActive = true;

				// Re-attach ALL existing camera consumers since layout is switching to sidebar mode
				for (const cameraConsumer of allCameraConsumers) {
					await this.attachVideoConsumer(
						cameraConsumer.participantId,
						cameraConsumer,
					);
				}
			}

			const screenStream = new MediaStream([track]);
			try {
				if (consumer?.appData && !consumer.appData.type) {
					consumer.appData.type = "screen";
				} else if (consumer && !consumer.appData) {
					consumer.appData = { type: "screen" };
				}
			} catch (_) {}

			if (this.eventHandlers.onScreenShareStarted) {
				this.eventHandlers.onScreenShareStarted({
					participantId,
					stream: screenStream,
					consumer,
				});
			}
		} catch (error) {
			console.error("❌ Failed to handle screen share consumer:", error);
		}
	}

	async flushBufferedProducers() {
		if (!this.bufferedProducerEvents.length) {
			console.log("📡 No buffered producer events to flush");
			return;
		}

		console.log(
			`📡 Flushing ${this.bufferedProducerEvents.length} buffered producer events`,
		);
		const pending = this.bufferedProducerEvents.splice(0);
		for (const event of pending) {
			try {
				if (!event || !event.producerId || !event.participantId) {
					console.warn("⚠️ Skipping malformed buffered producer event:", event);
					continue;
				}

				const metadata = { isScreen: !!event.isScreen };
				await this.subscribeToProducer(
					event.producerId,
					event.participantId,
					metadata,
				);
			} catch (error) {
				console.warn("⚠️ Failed to process buffered producer:", error);
			}
		}
	}

	setupSFUEventHandlers() {
		this.sfuClient.on("participant_joined", (data) => {
			this.participantManager.addParticipant(data);
		});

		this.sfuClient.on("participant_left", (data) => {
			this.participantManager.removeParticipant(data.participantId);
		});

		this.sfuClient.on("producer_created", async (data) => {
			// If we're syncing or the device isn't ready yet, buffer this event
			if (
				this.initialSyncInProgress ||
				!this.transportManager?.isDeviceLoaded?.()
			) {
				this.bufferedProducerEvents.push(data);
				return;
			}

			const isSelf = data.participantId === this.currentUser.value?.user_id;
			const isScreen = !!data.isScreen;
			if (!isSelf || isScreen) {
				const metadata = { isScreen };
				await this.subscribeToProducer(
					data.producerId,
					data.participantId,
					metadata,
				);
			}
		});

		this.sfuClient.on("producer_closed", (data) => {
			try {
				const pid = data?.participantId;
				const closedProducerId = data?.producerId;
				const closedIsScreen = data?.isScreen;
				if (pid) {
					const allForPid = this.consumerManager.getConsumersByParticipant(pid);
					for (const c of allForPid) {
						const producedMatch =
							closedProducerId &&
							(c.consumer?.producerId === closedProducerId ||
								c.producerId === closedProducerId ||
								(c.appData && c.appData.producerId === closedProducerId));
						const isScreenLike =
							c.isScreen ||
							c.appData?.type === "screen" ||
							c.consumer?.appData?.type === "screen";
						// Only remove screen consumers if the closed producer was also screen
						const shouldRemove =
							producedMatch || (isScreenLike && closedIsScreen);
						if (shouldRemove) {
							this.consumerManager.removeConsumer(c.id);
							try {
								this.processedConsumers.delete(c.id);
							} catch (_) {}
						}
					}
				}
			} catch (_) {}

			try {
				if (
					this.eventHandlers &&
					typeof this.eventHandlers.onScreenShareStopped === "function"
				) {
					this.eventHandlers.onScreenShareStopped({
						participantId: data?.participantId,
					});
				}
			} catch (_) {}
		});

		// When server explicitly notifies a consumer was closed, ensure local removal
		this.sfuClient.on("consumer_closed", (data) => {
			try {
				const consumerId = data?.consumerId;
				if (!consumerId) return;
				const removed = this.consumerManager.removeConsumer(consumerId);
				if (!removed) {
					// If not found by id, attempt to find by participant mapping if provided
					const pid = data?.participantId;
					if (pid) {
						const allForPid =
							this.consumerManager.getConsumersByParticipant(pid);
						for (const c of allForPid) {
							const maybeScreen =
								c.isScreen ||
								c.appData?.type === "screen" ||
								c.consumer?.appData?.type === "screen";
							if (maybeScreen) {
								this.consumerManager.removeConsumer(c.id);
							}
						}
					}
				}
			} catch (e) {
				console.warn("⚠️ Error handling consumer_closed", e.message);
			}
		});

		this.sfuClient.on("media_control_update", (data) => {
			// Server sends { participantId, action } where action can be
			// - a string: 'mute'|'unmute'|'video_off'|'video_on'
			// - or an object: { type: 'audio'|'video', enabled: boolean }
			const updates = {};
			const action = data?.action;
			if (action && typeof action === "object") {
				if (action.type === "audio" && typeof action.enabled === "boolean") {
					updates.audioEnabled = !!action.enabled;
				}
				if (action.type === "video" && typeof action.enabled === "boolean") {
					updates.videoEnabled = !!action.enabled;
				}
			} else if (typeof action === "string") {
				switch (action) {
					case "mute":
						updates.audioEnabled = false;
						break;
					case "unmute":
						updates.audioEnabled = true;
						break;
					case "video_off":
						updates.videoEnabled = false;
						break;
					case "video_on":
						updates.videoEnabled = true;
						break;
					default:
						break;
				}
			}

			if (Object.keys(updates).length) {
				this.participantManager.updateMediaState(data.participantId, updates);
			}
		});

		this.sfuClient.on("screen_share_started", (data) => {
			try {
				console.log("📡 SFU event: screen_share_started (from signaling)", {
					participantId: data.participantId,
					hasDirectStream: !!data.stream,
				});
			} catch (_) {}
			console.log(
				"📡 Deferring screen share notification until consumer creation",
			);
		});

		this.sfuClient.on("screen_share_stopped", (data) => {
			console.log("🖥️ Screen share stopped - resetting sidebar mode flag");
			this.isScreenShareActive = false;

			if (this.eventHandlers.onScreenShareStopped) {
				this.eventHandlers.onScreenShareStopped(data);
			}

			try {
				const pid = data?.participantId;
				if (pid) {
					const screenConsumers = this.consumerManager
						.getScreenShareConsumers()
						.filter((c) => c.participantId === pid);
					for (const sc of screenConsumers) {
						console.log("🧹 Removing screen-share consumer on stop:", {
							consumerId: sc.id,
							participantId: pid,
						});
						this.consumerManager.removeConsumer(sc.id);
						this.processedConsumers.delete(sc.id);
					}
					// Safety scan across participant consumers for any with screen-like appData
					const allForPid = this.consumerManager.getConsumersByParticipant(pid);
					for (const c of allForPid) {
						const maybeScreen =
							c.isScreen ||
							c.appData?.type === "screen" ||
							c.consumer?.appData?.type === "screen";
						if (maybeScreen) {
							console.log(
								"🧹 (safety) Removing screen-like consumer on stop:",
								{ consumerId: c.id, participantId: pid },
							);
							this.consumerManager.removeConsumer(c.id);
							this.processedConsumers.delete(c.id);
						}
					}
				}
			} catch (_) {}
		});
	}

	registerVideoElement(participantId, element) {
		this.videoManager.registerVideoElement(participantId, element);
	}

	async disconnect() {
		try {
			// Close producers/consumers and transports first
			try {
				this.consumerManager?.clear?.();
			} catch (_) {}
			try {
				this.mediaHandler?.cleanup?.();
			} catch (_) {}
			try {
				this.transportManager?.cleanup?.();
			} catch (_) {}
			if (this.sfuClient) {
				await this.sfuClient.disconnect();
			}
			this.isConnected = false;
		} catch (error) {
			console.error("❌ Error disconnecting from SFU:", error);
		}
	}

	/**
	 * Clean up all resources
	 */
	cleanup() {
		try {
			this.mediaHandler.cleanup();
		} catch (_) {}
		try {
			this.videoManager.cleanup();
		} catch (_) {}
		try {
			this.participantManager.clear();
		} catch (_) {}
		try {
			this.consumerManager.clear();
		} catch (_) {}
		try {
			this.transportManager.cleanup();
		} catch (_) {}
		try {
			this.waitingRoomManager.cleanup();
		} catch (_) {}

		this.disconnect();

		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.isSetupComplete = false;
	}

	/**
	 * Utility to ensure ref-like object
	 */
	ensureRef(obj) {
		if (obj && typeof obj === "object" && "value" in obj) {
			return obj;
		}
		return { value: obj };
	}
}

let sfuManagerInstance = null;

export function getSFUMeetingManager() {
	if (!sfuManagerInstance) {
		sfuManagerInstance = new SFUMeetingManager();
	}
	return sfuManagerInstance;
}

export function resetSFUMeetingManager() {
	if (sfuManagerInstance) {
		sfuManagerInstance.cleanup();
		sfuManagerInstance = null;
	}
}
