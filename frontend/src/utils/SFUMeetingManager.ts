/**
 * SFU Meeting Manager
 * Handles SFU connection, event management, and coordination between different media-related managers
 */

import type { Producer } from "mediasoup-client/types";
import type { ConsumerEntry } from "./media/ConsumerManager";
import { ConsumerManager } from "./media/ConsumerManager";
import {
	type ParticipantData,
	ParticipantManager,
} from "./media/ParticipantManager";
import { TransportManager } from "./media/TransportManager";
import { VideoElementManager } from "./media/VideoElementManager";
import type { SFUClient } from "./SFUClient";

interface MediaHandler {
	localStream: MediaStream | null;
	audioProducer: Producer | null;
	videoProducer: Producer | null;
	screenProducer: Producer | null;
	setProducers(producers?: Partial<MediaHandler>): void;
	stopScreenShare(): void;
	cleanup(): void;
}

function createMediaHandler(): MediaHandler {
	return {
		localStream: null,
		audioProducer: null,
		videoProducer: null,
		screenProducer: null,
		setProducers(producers = {}) {
			Object.assign(this, producers);
		},
		stopScreenShare() {
			this.screenProducer = null;
		},
		cleanup() {
			for (const p of [
				this.audioProducer,
				this.videoProducer,
				this.screenProducer,
			]) {
				try {
					p?.close();
				} catch (error: unknown) {
					console.warn("Failed to close producer during cleanup:", error);
				}
			}

			this.localStream = null;
			this.audioProducer = null;
			this.videoProducer = null;
			this.screenProducer = null;
		},
	};
}

interface SFUEventHandlers {
	onParticipantJoined?: (participant: unknown) => void;
	onParticipantLeft?: (data: {
		participantId: string;
		participant?: unknown;
	}) => void;
	onParticipantUpdated?: (
		participantId: string,
		participant: unknown,
		updates: unknown,
	) => void;
	onScreenShareStarted?: (data: unknown) => void;
	onScreenShareStopped?: (data: unknown) => void;
	onActiveSpeakerChanged?: (participantIds: string[]) => void;
	onHostMutedYou?: () => void;
	onHostKickedYou?: (data: unknown) => void;
}

interface SFUProducerEvent {
	producerId: string;
	participantId: string;
	isScreen?: boolean;
}

interface SFUProducerClosedEvent {
	participantId?: string;
	producerId?: string;
	isScreen?: boolean;
}

interface SFUMediaControlEvent {
	participantId: string;
	action?: string | { type: string; enabled: boolean };
}

interface SFUHostControlEvent {
	action: string;
	targetParticipantId: string;
	hostId?: string;
}

interface SFUMeetingManagerOptions {
	meetingId: string;
	currentUser: unknown;
	eventHandlers?: SFUEventHandlers;
}

export class SFUMeetingManager {
	sfuClient: SFUClient;
	meetingId: string | null;
	currentUser: { value: unknown };
	isConnected: boolean;
	isSetupComplete: boolean;
	initialSyncInProgress: boolean;
	bufferedProducerEvents: SFUProducerEvent[];
	processedConsumers: Set<string>;
	isScreenShareActive: boolean;

	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	consumerManager: ConsumerManager;
	transportManager: TransportManager;
	mediaHandler: MediaHandler;

	eventHandlers: SFUEventHandlers;
	recoveryInProgress: boolean;
	lastRecoveryAt: number;

	eventTarget: EventTarget;

	constructor(sfuClient: SFUClient) {
		this.sfuClient = sfuClient;
		this.meetingId = null;
		this.currentUser = { value: null };
		this.isConnected = false;
		this.isSetupComplete = false;
		this.initialSyncInProgress = false;
		this.bufferedProducerEvents = [];
		this.processedConsumers = new Set();
		this.isScreenShareActive = false;

		this.videoManager = new VideoElementManager();
		this.participantManager = new ParticipantManager();
		this.consumerManager = new ConsumerManager();
		this.transportManager = new TransportManager();
		this.mediaHandler = createMediaHandler();

		this.eventHandlers = {};
		this.recoveryInProgress = false;
		this.lastRecoveryAt = 0;

		this.eventTarget = new EventTarget();
	}

	initialize(options: SFUMeetingManagerOptions): void {
		this.meetingId = options.meetingId;
		this.currentUser = this.ensureRef(options.currentUser);
		this.eventHandlers = options.eventHandlers || {};

		this.setupManagerEventHandlers();
	}

	setupManagerEventHandlers(): void {
		// Participant manager events
		this.participantManager.setEventHandlers({
			onParticipantAdded: (participant: Record<string, unknown>) => {
				if (this.eventHandlers.onParticipantJoined) {
					this.eventHandlers.onParticipantJoined(participant);
				}
			},
			onParticipantRemoved: (
				participantId: string,
				participant: Record<string, unknown>,
			) => {
				this.videoManager.removeVideoElement(participantId);
				this.consumerManager.cleanupParticipantConsumers(participantId);
				if (this.eventHandlers.onParticipantLeft) {
					this.eventHandlers.onParticipantLeft({ participantId, participant });
				}
			},
			onParticipantUpdated: (
				participantId: string,
				participant: Record<string, unknown>,
				updates: Record<string, unknown>,
			) => {
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
			onConsumerAdded: (consumer: ConsumerEntry) => {
				this.handleNewConsumer(consumer);
			},
			onConsumerRemoved: (consumerId: string, consumer: ConsumerEntry) => {
				if (consumer?.isScreen || consumer?.appData?.type === "screen") {
					this.isScreenShareActive = false;
					if (this.eventHandlers.onScreenShareStopped) {
						this.eventHandlers.onScreenShareStopped({
							participantId: consumer.participantId,
							consumerId,
						});
					}
				}
			},
		});

		this.transportManager.setEventHandlers({
			onTransportConnectionStateChange: ({
				direction,
				state,
			}: {
				direction: string;
				state: string;
			}) => {
				this.handleTransportConnectionStateChange(direction, state);
			},
		});
	}

	async connect(authToken: string | null = null): Promise<boolean> {
		if (this.isConnected) {
			return true;
		}

		try {
			await this.sfuClient.connect(this.meetingId ?? "", authToken);
			this.isConnected = true;

			// Initialize transport manager with SFU client
			this.transportManager.initialize(this.sfuClient);

			// Set up SFU event handlers
			this.setupSFUEventHandlers();

			return true;
		} catch (error) {
			console.error("Failed to connect to SFU:", error);
			throw error;
		}
	}

	async joinRoom(userData: unknown, mediaState: unknown): Promise<boolean> {
		try {
			await this.sfuClient.joinRoom(this.meetingId ?? "", userData, mediaState);
			console.log("Successfully joined room:", this.meetingId);

			return true;
		} catch (error) {
			console.error("Failed to join room:", error);
			throw error;
		}
	}

	async initializeDevice(): Promise<boolean> {
		try {
			await this.transportManager.initializeDevice();
			return true;
		} catch (error) {
			console.error("Failed to initialize MediaSoup device:", error);
			throw error;
		}
	}

	async createReceiveTransport(): Promise<boolean> {
		try {
			await this.transportManager.createReceiveTransport();
			return true;
		} catch (error) {
			console.warn("Failed to create receive transport:", error);
			return false;
		}
	}

	async publishMedia(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const { publishVideo = true, publishAudio = true } = options;
		const results: Record<string, unknown> = {};

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
						console.log("Video published successfully");
					} catch (error: unknown) {
						console.warn(
							"Failed to publish video, continuing without video:",
							(error as Error).message,
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
						console.log("Audio published successfully");
					} catch (error: unknown) {
						console.warn(
							"Failed to publish audio, continuing without audio:",
							(error as Error).message,
						);
					}
				}
			}
			console.log("Media published successfully");
			return results;
		} catch (error) {
			console.error("Failed to publish media:", error);
			throw error;
		}
	}

	async setupExistingParticipants(): Promise<void> {
		try {
			this.initialSyncInProgress = true;

			const participants = await this.sfuClient.getRoomParticipants();

			// Get current user ID to filter out self from participants
			const currentUserId = this.getCurrentUserId();

			const normalized = (participants || [])
				.map((p: Record<string, unknown>) => {
					const info = (p.info || {}) as Record<string, unknown>;
					return {
						participantId: (p.user_id ?? p.id) as string,
						user_id: (p.user_id ?? p.id) as string,
						user_name: (info.name ??
							info.user_name ??
							p.user_id ??
							"") as string,
						avatar: (info.avatar ?? null) as string | null,
						audio_enabled:
							typeof info.audio_enabled === "boolean"
								? info.audio_enabled
								: false,
						video_enabled:
							typeof info.video_enabled === "boolean"
								? info.video_enabled
								: false,
						is_guest: (info.is_guest as boolean) || false,
					};
				})
				.filter((p) => p.user_id !== currentUserId);

			this.participantManager.syncParticipants(normalized);

			await this.requestExistingProducers();

			await this.flushBufferedProducers();

			this.initialSyncInProgress = false;
		} catch (error) {
			console.error("Error in setupExistingParticipants:", error);
			this.initialSyncInProgress = false;
			throw error;
		}
	}

	async requestExistingProducers(): Promise<unknown[] | null> {
		try {
			const existingProducers = await this.sfuClient.getExistingProducers();

			if (existingProducers?.length) {
				console.log(
					`Found ${existingProducers.length} existing producers:`,
					existingProducers.map((p: unknown) => {
						const producer = p as Record<string, unknown>;
						return {
							id: producer.id,
							participantId:
								producer.participantId || producer.user_id || producer.userId,
							kind: producer.kind,
							isScreen: !!producer.isScreen,
						};
					}),
				);

				for (const producerInfo of existingProducers) {
					const info = producerInfo as Record<string, unknown>;
					const participantId = (info.participantId ??
						info.user_id ??
						info.userId) as string;

					console.log("Subscribing to existing producer:", {
						producerId: info.id,
						participantId,
						kind: info.kind,
						isScreen: !!info.isScreen,
					});
					await this.subscribeToRemoteProducer({
						producerId: info.id as string,
						participantId,
						isScreen: !!info.isScreen,
					});
				}
			} else {
				console.log("No existing producers found");
			}

			return existingProducers;
		} catch (error) {
			console.warn("Failed to request existing producers:", error);
			return null;
		}
	}

	async subscribeToProducer(
		producerId: string,
		participantId: string,
		metadata: Record<string, unknown> = {},
	): Promise<unknown> {
		try {
			const consumer = await this.transportManager.createConsumer(
				producerId,
				metadata,
			);

			const enhancedConsumer = this.consumerManager.addConsumer(
				consumer,
				participantId,
			);

			// for adaptive streaming
			if (enhancedConsumer && enhancedConsumer.kind === "video") {
				this.eventTarget.dispatchEvent(
					new CustomEvent("consumerReady", {
						detail: {
							consumerId: enhancedConsumer.id,
							participantId,
							kind: enhancedConsumer.kind,
						},
					}),
				);
			}

			return enhancedConsumer;
		} catch (error) {
			console.error(`Failed to subscribe to producer ${producerId}:`, error);
			throw error;
		}
	}

	async subscribeToRemoteProducer({
		producerId,
		participantId,
		isScreen,
	}: {
		producerId: string;
		participantId: string;
		isScreen: boolean;
	}): Promise<unknown | null> {
		if (!producerId || !participantId) {
			return null;
		}

		if (participantId === this.getCurrentUserId()) {
			return null;
		}

		return this.subscribeToProducer(producerId, participantId, {
			isScreen: !!isScreen,
		});
	}

	async handleNewConsumer(consumer: ConsumerEntry): Promise<void> {
		const { participantId, kind, isScreen } = consumer;

		if (this.processedConsumers?.has?.(consumer?.id as string)) {
			return;
		}

		if (!this.processedConsumers) {
			this.processedConsumers = new Set();
		}
		this.processedConsumers.add(consumer?.id as string);

		if (!participantId) {
			return;
		}

		const currentUserId = this.getCurrentUserId();
		if (participantId === currentUserId) {
			return;
		}

		if (!this.participantManager.hasParticipant(participantId as string)) {
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
			await this.attachVideoConsumer(participantId as string, consumer);
		} else if (kind === "audio") {
			await this.attachAudioConsumer(participantId as string, consumer);
		}
	}

	async attachVideoConsumer(
		participantId: string,
		consumer: ConsumerEntry,
	): Promise<void> {
		try {
			// only attach the video track as audio is managed separately
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			await this.videoManager.attachStream(participantId, stream, false);

			const participant = this.participantManager.getParticipant(participantId);
			if (participant && !participant.video_enabled) {
				this.participantManager.updateParticipant(participantId, {
					video_enabled: true,
				});
			}
		} catch (error) {
			console.error(
				`Failed to attach video consumer for ${participantId}:`,
				error,
			);
		}
	}

	async attachAudioConsumer(
		participantId: string,
		consumer: ConsumerEntry,
	): Promise<void> {
		try {
			// Only attach the audio track as video is managed separately
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			await this.videoManager.attachStream(participantId, stream, false);
		} catch (error) {
			console.error(
				`Failed to attach audio consumer for ${participantId}:`,
				error,
			);
		}
	}

	async handleScreenShareConsumer(consumer: ConsumerEntry): Promise<void> {
		const participantId = consumer.participantId;
		const track = consumer.track as MediaStreamTrack;

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
			if (consumer.appData && !consumer.appData.type) {
				consumer.appData.type = "screen";
			} else if (consumer && !consumer.appData) {
				consumer.appData = { type: "screen" };
			}

			if (this.eventHandlers.onScreenShareStarted) {
				this.eventHandlers.onScreenShareStarted({
					participantId,
					stream: screenStream,
					consumer,
				});
			}
		} catch (error) {
			console.error("Failed to handle screen share consumer:", error);
		}
	}

	async flushBufferedProducers(): Promise<void> {
		if (!this.bufferedProducerEvents.length) {
			console.log("No buffered producer events to flush");
			return;
		}

		console.log(
			`Flushing ${this.bufferedProducerEvents.length} buffered producer events`,
		);
		const pending = this.bufferedProducerEvents.splice(0);
		for (const event of pending) {
			try {
				if (!event?.producerId || !event.participantId) {
					console.warn("Skipping malformed buffered producer event:", event);
					continue;
				}

				// Check if we already have a consumer for this producer
				const existingConsumers =
					this.consumerManager.getConsumersByParticipant(
						event.participantId as string,
					);
				const alreadySubscribed = existingConsumers.some((c) => {
					return c.consumer.producerId === event.producerId;
				});

				if (alreadySubscribed) {
					continue;
				}

				await this.subscribeToRemoteProducer({
					producerId: event.producerId as string,
					participantId: event.participantId as string,
					isScreen: !!event.isScreen,
				});
			} catch (error) {
				console.warn("Failed to process buffered producer:", error);
			}
		}
	}

	setupSFUEventHandlers(): void {
		this.sfuClient.on("reconnect", () => {
			this.recoverTransportIce("socket_reconnect");
		});

		this.sfuClient.on("participant_joined", (data: ParticipantData) => {
			const currentUserId = this.getCurrentUserId();
			const joinedUserId = data.participantId || data.user_id || "";

			if (joinedUserId && joinedUserId !== currentUserId) {
				this.participantManager.addParticipant(data);
			}
		});

		this.sfuClient.on("participant_left", (data: ParticipantData) => {
			const d = data as ParticipantData;
			this.participantManager.removeParticipant(d.participantId || "");
		});

		this.sfuClient.on("producer_created", async (data: unknown) => {
			const d = data as SFUProducerEvent;
			if (d.participantId === this.getCurrentUserId()) return;

			// If we're syncing or the device isn't ready yet, buffer this event
			if (
				this.initialSyncInProgress ||
				!this.transportManager?.isDeviceLoaded?.()
			) {
				this.bufferedProducerEvents.push(d);
				return;
			}

			await this.subscribeToRemoteProducer({
				producerId: d.producerId,
				participantId: d.participantId,
				isScreen: !!d.isScreen,
			});
		});

		this.sfuClient.on("producer_closed", (data: unknown) => {
			const d = data as SFUProducerClosedEvent;
			const pid = d.participantId;
			const closedProducerId = d.producerId;
			const closedIsScreen = d.isScreen;
			if (pid) {
				const allForPid = this.consumerManager.getConsumersByParticipant(pid);
				for (const c of allForPid) {
					const producedMatch =
						(closedProducerId && c.consumer.producerId === closedProducerId) ||
						c.appData?.producerId === closedProducerId;
					const isScreenLike =
						c.isScreen ||
						c.appData?.type === "screen" ||
						c.consumer.appData?.type === "screen";
					const shouldRemove =
						producedMatch || (isScreenLike && closedIsScreen);
					if (shouldRemove) {
						this.consumerManager.removeConsumer(c.id);
						this.processedConsumers.delete(c.id);
					}
				}
			}

			if (this.eventHandlers && d?.isScreen) {
				this.eventHandlers.onScreenShareStopped?.({
					participantId: d.participantId,
				});
			}
		});

		// When server explicitly notifies a consumer was closed, ensure local removal
		this.sfuClient.on("consumer_closed", (data: unknown) => {
			try {
				const d = data as { consumerId?: string; participantId?: string };
				const consumerId = d.consumerId;
				if (!consumerId) return;
				const removed = this.consumerManager.removeConsumer(consumerId);
				if (!removed) {
					const pid = d.participantId;
					if (pid) {
						const allForPid =
							this.consumerManager.getConsumersByParticipant(pid);
						for (const c of allForPid) {
							const maybeScreen =
								c.isScreen ||
								c.appData?.type === "screen" ||
								(c.consumer as { appData?: { type?: string } })?.appData
									?.type === "screen";
							if (maybeScreen) {
								this.consumerManager.removeConsumer(c.id);
							}
						}
					}
				}
			} catch (e: unknown) {
				console.warn("Error handling consumer_closed", (e as Error).message);
			}
		});

		this.sfuClient.on("media_control_update", (data: unknown) => {
			const d = data as SFUMediaControlEvent;
			const updates: Record<string, boolean> = {};
			if (d.action && typeof d.action === "object") {
				const a = d.action;
				if (a.type === "audio" && typeof a.enabled === "boolean") {
					updates.audioEnabled = !!a.enabled;
				}
				if (a.type === "video" && typeof a.enabled === "boolean") {
					updates.videoEnabled = !!a.enabled;
				}
			} else if (typeof d.action === "string") {
				switch (d.action) {
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
				this.participantManager.updateMediaState(d.participantId, updates);
			}
		});

		this.sfuClient.on("network_quality_update", (data: unknown) => {
			const d = data as { participantId?: string; quality?: string };
			if (d.participantId && d.quality) {
				this.participantManager.updateParticipant(d.participantId, {
					networkQuality: d.quality,
				});
			}
		});

		this.sfuClient.on("host_control_update", (data: unknown) => {
			const d = data as SFUHostControlEvent;
			const myParticipantId = this.getCurrentUserId();
			const isForMe = d.targetParticipantId === myParticipantId;

			switch (d.action) {
				case "mute_participant":
					if (isForMe) {
						this.eventHandlers.onHostMutedYou?.();
					} else {
						this.participantManager.updateMediaState(d.targetParticipantId, {
							audioEnabled: false,
						});
					}
					break;
				case "kick_participant":
					if (isForMe) {
						this.eventHandlers.onHostKickedYou?.({ hostId: d.hostId });
					}
					break;
				default:
					console.warn("Unknown host control action:", d.action);
			}
		});

		this.sfuClient.on("screen_share_started", (data: unknown) => {
			const d = data as { participantId?: string; stream?: MediaStream };
			console.log("SFU event: screen_share_started (from signaling)", {
				participantId: d.participantId,
				hasDirectStream: !!d.stream,
			});
		});

		this.sfuClient.on("screen_share_stopped", (data: unknown) => {
			const d = data as { participantId?: string };
			console.log("Screen share stopped - resetting sidebar mode flag");
			this.isScreenShareActive = false;

			if (this.eventHandlers.onScreenShareStopped) {
				this.eventHandlers.onScreenShareStopped(data);
			}

			const pid = d.participantId;
			if (pid) {
				const screenConsumers = this.consumerManager
					.getScreenShareConsumers()
					.filter((c) => c.participantId === pid);
				for (const sc of screenConsumers) {
					console.log("Removing screen-share consumer on stop:", {
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
						(c.consumer as { appData?: { type?: string } })?.appData?.type ===
							"screen";
					if (maybeScreen) {
						console.log("(safety) Removing screen-like consumer on stop:", {
							consumerId: c.id,
							participantId: pid,
						});
						this.consumerManager.removeConsumer(c.id);
						this.processedConsumers.delete(c.id);
					}
				}
			}
		});

		this.sfuClient.on("active_speaker", (data: unknown) => {
			const d = data as { participantIds: string[] };
			if (this.eventHandlers.onActiveSpeakerChanged) {
				this.eventHandlers.onActiveSpeakerChanged(d.participantIds);
			}
		});
	}

	handleTransportConnectionStateChange(direction: string, state: string): void {
		if (state === "failed" || state === "closed") {
			this.recoverTransportIce(`transport_${direction}_${state}`);
		}
	}

	async recoverTransportIce(reason: string): Promise<boolean> {
		if (this.recoveryInProgress) {
			return false;
		}

		if (!this.sfuClient?.isConnected?.()) {
			return false;
		}

		const now = Date.now();
		if (now - this.lastRecoveryAt < 7000) {
			return false;
		}

		this.recoveryInProgress = true;
		this.lastRecoveryAt = now;

		try {
			console.warn("Restarting SFU transport ICE", {
				reason,
				meetingId: this.meetingId,
			});

			const restarted = await this.transportManager.restartAllTransportIce();
			if (!restarted) {
				return false;
			}

			console.log("SFU transport ICE restart completed", { reason });
			return true;
		} catch (error) {
			console.error("SFU transport ICE restart failed:", error);
			return false;
		} finally {
			this.recoveryInProgress = false;
		}
	}

	registerVideoElement(participantId: string, element: HTMLElement): void {
		this.videoManager.registerVideoElement(participantId, element);
	}

	getVideoConsumerEntry(participantId: string): unknown {
		return this.consumerManager.getVideoConsumer(participantId);
	}

	async updateConsumerStreamPreferences(
		consumerId: string,
		preferences: {
			visible: boolean;
			width: number;
			height: number;
		},
	): Promise<unknown | null> {
		if (!this.sfuClient?.isConnected()) {
			return null;
		}

		try {
			return await this.sfuClient.updateConsumerPreferences({
				consumerId,
				visible: preferences.visible,
				width: preferences.width,
				height: preferences.height,
			});
		} catch (error) {
			console.warn(
				"Failed to update consumer preferences",
				consumerId,
				(error as Error)?.message || error,
			);
			return null;
		}
	}

	async disconnect(): Promise<void> {
		try {
			this.recoveryInProgress = false;

			// Close producers/consumers and transports first
			this.consumerManager?.clear?.();
			this.mediaHandler?.cleanup?.();
			this.transportManager?.cleanup?.();
			if (this.sfuClient) {
				await this.sfuClient.disconnect();
			}
			this.isConnected = false;
		} catch (error) {
			console.error("Error disconnecting from SFU:", error);
		}
	}

	/**
	 * Clean up all resources
	 */
	cleanup(): void {
		this.mediaHandler.cleanup();
		this.videoManager.cleanup();
		this.participantManager.clear();
		this.consumerManager.clear();
		this.transportManager.cleanup();

		this.disconnect();

		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.isSetupComplete = false;
		this.recoveryInProgress = false;
		this.lastRecoveryAt = 0;
	}

	/**
	 * Utility to ensure ref-like object
	 */
	ensureRef(obj: unknown): { value: unknown } {
		if (obj && typeof obj === "object" && "value" in (obj as object)) {
			return obj as { value: unknown };
		}
		return { value: obj };
	}

	getCurrentUserId(): string | null {
		const cu = this.currentUser?.value || this.currentUser;
		return (
			((cu as Record<string, unknown>)?.user_id as string) ||
			((cu as Record<string, unknown>)?.userId as string) ||
			null
		);
	}
}
