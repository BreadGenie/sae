import type { AppData, Consumer } from '../types';
import type {
	CloseProducerResult,
	DtlsParameters,
	ExistingProducer,
	IceCandidate,
	IceParameters,
	MediaControlAction,
	ParticipantInfo,
	Peer,
	PeerInfo,
	Room,
	RtpCapabilities,
	RtpParameters,
} from '../types';
import { loggers } from '../utils/logger';
import { ConsumerManager } from './ConsumerManager';
import { PeerManager } from './PeerManager';
import { ProducerManager } from './ProducerManager';
import { RoomManager } from './RoomManager';
import { TransportManager } from './TransportManager';
import { WorkerManager } from './WorkerManager';
import { mediasoupConfig } from './config';

export class MediasoupManager {
	private workerManager = new WorkerManager();
	private roomManager = new RoomManager();
	private peerManager = new PeerManager();
	private transportManager = new TransportManager();
	private producerManager = new ProducerManager();
	private consumerManager = new ConsumerManager();

	async init(): Promise<void> {
		loggers.mediasoupManager.info('Initializing Mediasoup');

		await this.workerManager.initialize(
			mediasoupConfig.numWorkers,
			mediasoupConfig.worker,
		);

		loggers.mediasoupManager.info('Mediasoup initialized successfully');
	}

	async createRoom(
		roomId: string,
		onActiveSpeaker?: (roomId: string, participantIds: string[]) => void,
	): Promise<Room> {
		const worker = this.workerManager.getNextWorker();
		return this.roomManager.createRoom(
			roomId,
			worker,
			mediasoupConfig.router.mediaCodecs,
			onActiveSpeaker,
		);
	}

	async closeRoom(roomId: string): Promise<void> {
		await this.roomManager.closeRoom(roomId);
	}

	async addPeer(
		roomId: string,
		peerId: string,
		peerInfo: PeerInfo = {
			name: peerId,
			userId: peerId,
			audio_enabled: true,
			video_enabled: true,
		},
	): Promise<Peer> {
		const room = this.roomManager.getRoom(roomId);
		if (!room) {
			throw new Error(`Room ${roomId} not found`);
		}

		return this.peerManager.addPeer(room, peerId, peerInfo);
	}

	async removePeer(roomId: string, peerId: string): Promise<void> {
		const room = this.roomManager.getRoom(roomId);
		if (!room) return;

		this.peerManager.removePeer(room, peerId);

		// Close room if empty
		if (room.peers.size === 0) {
			await this.closeRoom(roomId);
		}
	}

	async createWebRtcTransport(
		roomId: string,
		peerId: string,
		direction: 'send' | 'recv',
	): Promise<{
		id: string;
		iceParameters: IceParameters;
		iceCandidates: IceCandidate[];
		dtlsParameters: DtlsParameters;
	}> {
		const room = this.roomManager.getRoom(roomId);
		if (!room) {
			throw new Error(`Room ${roomId} not found`);
		}

		const peer = room.peers.get(peerId);
		if (!peer) {
			throw new Error(`Peer ${peerId} not found in room ${roomId}`);
		}

		return this.transportManager.createWebRtcTransport(
			roomId,
			peerId,
			room.router,
			direction,
			mediasoupConfig.webRtcTransport,
		);
	}

	async connectWebRtcTransport(
		transportId: string,
		dtlsParameters: DtlsParameters,
	): Promise<void> {
		return this.transportManager.connectWebRtcTransport(
			transportId,
			dtlsParameters,
		);
	}

	async createProducer(
		transportId: string,
		rtpParameters: RtpParameters,
		kind: 'audio' | 'video',
		appData: AppData = {},
	): Promise<{ id: string; kind: 'audio' | 'video'; appData: AppData }> {
		const transportData = this.transportManager.getTransportData(transportId);
		if (!transportData) {
			throw new Error(`Transport ${transportId} not found`);
		}

		const { roomId, peerId, transport } = transportData;
		const room = this.roomManager.getRoom(roomId);
		if (!room) {
			throw new Error(`Room ${roomId} not found`);
		}
		const peer = room.peers.get(peerId);
		if (!peer) {
			throw new Error(`Peer ${peerId} not found in room ${roomId}`);
		}

		const result = await this.producerManager.createProducer(
			transport,
			roomId,
			peerId,
			rtpParameters,
			kind,
			appData,
		);

		const producer = this.producerManager.getProducer(result.id);
		if (!producer) {
			throw new Error(`Failed to create producer ${result.id}`);
		}
		peer.producers.set(result.id, producer);

		// Add audio producers to the audio level observer for active speaker detection
		if (kind === 'audio') {
			room.audioLevelObserver.addProducer({ producerId: result.id });
		}

		return result;
	}

	async createConsumer(
		transportId: string,
		producerId: string,
		rtpCapabilities: RtpCapabilities,
	): Promise<{
		id: string;
		producerId: string;
		kind: 'audio' | 'video';
		rtpParameters: RtpParameters;
		paused: boolean;
	}> {
		const transportData = this.transportManager.getTransportData(transportId);
		if (!transportData) {
			throw new Error(`Transport ${transportId} not found`);
		}

		const producerData = this.producerManager.getProducerData(producerId);
		if (!producerData) {
			throw new Error(`Producer ${producerId} not found`);
		}

		const { roomId, peerId, transport } = transportData;
		const room = this.roomManager.getRoom(roomId);
		if (!room) {
			throw new Error(`Room ${roomId} not found`);
		}

		// Validate router can consume
		if (!room.router.canConsume({ producerId, rtpCapabilities })) {
			throw new Error(
				`Router cannot consume producer ${producerId} - RTP capabilities mismatch`,
			);
		}

		const result = await this.consumerManager.createConsumer(
			transport,
			producerData.producer,
			producerId,
			roomId,
			peerId,
			rtpCapabilities,
		);

		const peer = room.peers.get(peerId);
		if (!peer) {
			throw new Error(`Peer ${peerId} not found in room ${roomId}`);
		}

		const consumer = this.consumerManager.getConsumer(result.id);
		if (!consumer) {
			throw new Error(`Failed to create consumer ${result.id}`);
		}
		peer.consumers.set(result.id, consumer);

		return result;
	}

	closeProducer(producerId: string): CloseProducerResult {
		const producerData = this.producerManager.getProducerData(producerId);
		if (!producerData) return { isScreen: false, removedConsumers: [] };

		const result = this.producerManager.closeProducer(producerId);

		const room = this.roomManager.getRoom(producerData.roomId);
		if (room) {
			const peer = room.peers.get(producerData.peerId);
			if (peer) {
				peer.producers.delete(producerId);
			}
		}

		// Close related consumers
		const removedConsumers: CloseProducerResult['removedConsumers'] = [];
		const consumersToClose =
			this.consumerManager.getConsumersByProducer(producerId);
		for (const consumerData of consumersToClose) {
			try {
				this.consumerManager.closeConsumer(consumerData.consumer.id);
				const targetPeerId = consumerData.peerId;
				removedConsumers.push({
					consumerId: consumerData.consumer.id,
					peerId: targetPeerId,
					roomId: consumerData.roomId,
				});
			} catch (e) {
				loggers.mediasoupManager.warn(
					'Error while closing consumer %s: %s',
					consumerData.consumer.id,
					(e as Error).message,
				);
			}
		}

		return { ...result, removedConsumers };
	}

	closeConsumer(consumerId: string): void {
		this.consumerManager.closeConsumer(consumerId);
	}

	async updateConsumerPreferences(options: {
		consumerId: string;
		visible: boolean;
		width: number;
		height: number;
	}): Promise<{
		appliedLayers?: {
			spatialLayer: number | null;
			temporalLayer: number | null;
		};
		paused: boolean;
	}> {
		const consumerData = this.consumerManager.getConsumerData(
			options.consumerId,
		);
		if (!consumerData) {
			throw new Error(`Consumer ${options.consumerId} not found`);
		}

		const { consumer } = consumerData;
		const wasPaused = consumer.paused;

		loggers.mediasoupManager.debug(
			'Updating consumer preferences: consumerId=%s, visible=%s, width=%s, height=%s, wasPaused=%s',
			options.consumerId,
			options.visible,
			options.width,
			options.height,
			wasPaused,
		);

		if (!options.visible) {
			await this.consumerManager.pauseConsumer(options.consumerId);
			loggers.mediasoupManager.debug(
				'Paused consumer %s (not visible)',
				options.consumerId,
			);
			return { paused: true };
		}

		await this.consumerManager.resumeConsumer(options.consumerId);
		loggers.mediasoupManager.debug('Resumed consumer %s', options.consumerId);

		let appliedLayers:
			| { spatialLayer: number | null; temporalLayer: number | null }
			| undefined;

		if (consumer.kind === 'video') {
			const spatialLayer = this.estimateSpatialLayer(
				consumer,
				options.width,
				options.height,
			);
			const preferredLayers = (
				consumer as unknown as {
					preferredLayers?: {
						spatialLayer: number;
						temporalLayer: number;
					} | null;
				}
			).preferredLayers;
			const currentlyPreferred = preferredLayers?.spatialLayer ?? null;
			const currentTemporalLayer = preferredLayers?.temporalLayer ?? null;

			loggers.mediasoupManager.debug(
				'Spatial layer estimation: consumerId=%s, estimated=%s, current=%s, width=%s, height=%s',
				options.consumerId,
				spatialLayer,
				currentlyPreferred,
				options.width,
				options.height,
			);

			// Only update layers if spatialLayer is valid and different
			if (spatialLayer !== null && spatialLayer !== currentlyPreferred) {
				const layerResult =
					await this.consumerManager.setConsumerPreferredLayers(
						options.consumerId,
						spatialLayer,
					);
				if (layerResult) {
					appliedLayers = layerResult;
					loggers.mediasoupManager.debug(
						'Applied spatial layer: consumerId=%s, spatialLayer=%s, temporalLayer=%s',
						options.consumerId,
						layerResult.spatialLayer,
						layerResult.temporalLayer,
					);
					const currentLayers = (
						consumer as unknown as {
							currentLayers?: {
								spatialLayer: number | null;
								temporalLayer: number | null;
							} | null;
						}
					).currentLayers;
					const previousSpatial = currentLayers?.spatialLayer ?? null;
					if (
						layerResult.spatialLayer !== null &&
						typeof (
							consumer as unknown as { requestKeyFrame?: () => Promise<void> }
						).requestKeyFrame === 'function' &&
						((previousSpatial !== null &&
							layerResult.spatialLayer > previousSpatial) ||
							wasPaused)
					) {
						try {
							await consumer.requestKeyFrame();
						} catch (error) {
							loggers.mediasoupManager.warn(
								'Failed to request key frame for consumer %s: %s',
								consumer.id,
								(error as Error).message,
							);
						}
					}
				}
			} else {
				// Even if we didn't change layers, return the current state
				// This happens when spatialLayer is null (single layer) or matches current
				if (spatialLayer !== null || currentlyPreferred !== null) {
					appliedLayers = {
						spatialLayer: spatialLayer ?? currentlyPreferred,
						temporalLayer: currentTemporalLayer,
					};
					loggers.mediasoupManager.debug(
						'No layer change needed: consumerId=%s, spatialLayer=%s, temporalLayer=%s',
						options.consumerId,
						appliedLayers.spatialLayer,
						appliedLayers.temporalLayer,
					);
				}
			}
		}

		return {
			paused: consumer.paused,
			appliedLayers,
		};
	}

	private estimateSpatialLayer(
		consumer: Consumer,
		width: number,
		height: number,
	): number | null {
		const availableLayers = this.getAvailableSpatialLayers(consumer);
		loggers.mediasoupManager.debug(
			'Estimating spatial layer: consumerId=%s, availableLayers=%s, width=%s, height=%s',
			consumer.id,
			availableLayers,
			width,
			height,
		);

		if (availableLayers <= 1) {
			loggers.mediasoupManager.debug(
				'Single layer detected for consumer %s, skipping layer selection',
				consumer.id,
			);
			return null;
		}

		const safeWidth = Math.max(width, 0);

		// Use width as the primary dimension for layer selection
		// (videos are typically landscape, so width is more meaningful)
		const primaryDimension = safeWidth;

		if (primaryDimension <= 0) {
			return 0;
		}

		// Layer 2 (high): >= 640px
		// Layer 1 (mid): 480-639px
		// Layer 0 (low): < 480px
		let desiredLayer = 0;
		if (primaryDimension >= 640) {
			desiredLayer = 2;
		} else if (primaryDimension >= 480) {
			desiredLayer = 1;
		} else {
			desiredLayer = 0;
		}

		const finalLayer = Math.min(desiredLayer, availableLayers - 1);
		loggers.mediasoupManager.debug(
			'Selected spatial layer: consumerId=%s, primaryDimension=%s (width), desiredLayer=%s, finalLayer=%s',
			consumer.id,
			primaryDimension,
			desiredLayer,
			finalLayer,
		);

		return finalLayer;
	}

	private getAvailableSpatialLayers(consumer: Consumer): number {
		const encodings = Array.isArray(consumer.rtpParameters?.encodings)
			? consumer.rtpParameters.encodings
			: [];

		if (encodings.length > 1) {
			loggers.mediasoupManager.debug(
				'Multiple encodings detected for consumer %s: count=%s',
				consumer.id,
				encodings.length,
			);
			return encodings.length;
		}

		const scalabilityMode = encodings[0]?.scalabilityMode;
		if (typeof scalabilityMode === 'string') {
			const match = /^L(\d+)/.exec(scalabilityMode);
			if (match) {
				const layers = Number.parseInt(match[1], 10);
				if (Number.isFinite(layers) && layers > 0) {
					loggers.mediasoupManager.debug(
						'Scalability mode detected for consumer %s: mode=%s, layers=%s',
						consumer.id,
						scalabilityMode,
						layers,
					);
					return layers;
				}
			}
		}

		loggers.mediasoupManager.debug(
			'Single layer stream for consumer %s (no simulcast/SVC)',
			consumer.id,
		);
		return 1;
	}

	getRouterRtpCapabilities(roomId: string): RtpCapabilities {
		const router = this.roomManager.getRouter(roomId);
		if (!router) {
			throw new Error(`Room ${roomId} not found`);
		}
		return router.rtpCapabilities;
	}

	async getExistingProducers(
		roomId: string,
		userId: string,
	): Promise<ExistingProducer[]> {
		loggers.mediasoupManager.debug(
			'Getting existing producers for room %s, excluding user %s',
			roomId,
			userId,
		);

		const existingProducers: ExistingProducer[] = [];
		const room = this.roomManager.getRoom(roomId);
		if (!room) {
			return existingProducers;
		}

		for (const [peerId, peer] of room.peers) {
			// Exclude requester
			if (peerId === userId) continue;

			for (const producer of peer.producers.values()) {
				existingProducers.push({
					id: producer.id,
					roomId,
					user_id: peerId,
					kind: producer.kind,
					paused: producer.paused,
					isScreen:
						(producer.appData && producer.appData.type === 'screen') || false,
				});
			}
		}

		return existingProducers;
	}

	getRoomParticipants(roomId: string): ParticipantInfo[] {
		const room = this.roomManager.getRoom(roomId);
		if (!room) return [];

		return Array.from(room.peers.entries()).map(([peerId, peer]) => {
			let audioEnabled = false;
			let videoEnabled = false;
			for (const producer of peer.producers.values()) {
				if (producer.kind === 'audio' && !producer.paused) audioEnabled = true;
				if (producer.kind === 'video' && !producer.paused) videoEnabled = true;
			}
			return {
				id: peerId,
				user_id: peerId,
				info: {
					name: peer.info.name,
					userId: peer.info.userId,
					avatar: peer.info.avatar,
					audio_enabled: audioEnabled,
					video_enabled: videoEnabled,
				},
			};
		});
	}

	applyMediaControl(
		roomId: string,
		peerId: string,
		action: MediaControlAction,
	): void {
		const room = this.roomManager.getRoom(roomId);
		if (!room) return;

		const peer = room.peers.get(peerId);
		if (!peer) return;

		const setFlag = (k: 'audio_enabled' | 'video_enabled', v: boolean) => {
			peer.info[k] = v;
		};

		switch (action) {
			case 'mute':
				setFlag('audio_enabled', false);
				break;
			case 'unmute':
				setFlag('audio_enabled', true);
				break;
			case 'video_off':
				setFlag('video_enabled', false);
				break;
			case 'video_on':
				setFlag('video_enabled', true);
				break;
		}
	}

	get rooms() {
		return this.roomManager;
	}

	get peers() {
		return this.peerManager;
	}

	async cleanup(): Promise<void> {
		loggers.mediasoupManager.info('Starting MediaSoup cleanup');

		const initialStats = {
			rooms: this.roomManager.getRoomCount(),
			peers: this.peerManager.getPeerCount(),
			transports: this.transportManager.getTransportCount(),
			producers: this.producerManager.getProducerCount(),
			consumers: this.consumerManager.getConsumerCount(),
			workers: this.workerManager.getAllWorkers().length,
		};
		loggers.mediasoupManager.info('Initial cleanup stats: %o', initialStats);

		// Close all rooms (this will also close peers, transports, producers, consumers)
		await this.roomManager.cleanup();

		// Close all remaining managers
		this.consumerManager.cleanup();
		this.producerManager.cleanup();
		this.transportManager.cleanup();
		this.peerManager.cleanup();

		// Close all workers
		await this.workerManager.cleanup();

		const finalStats = {
			rooms: this.roomManager.getRoomCount(),
			peers: this.peerManager.getPeerCount(),
			transports: this.transportManager.getTransportCount(),
			producers: this.producerManager.getProducerCount(),
			consumers: this.consumerManager.getConsumerCount(),
			workers: this.workerManager.getAllWorkers().length,
		};
		loggers.mediasoupManager.info('Final cleanup stats: %o', finalStats);
		loggers.mediasoupManager.info('MediaSoup cleanup completed');
	}
}
