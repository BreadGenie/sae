import type { AppData } from '../types';
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

	async createRoom(roomId: string): Promise<Room> {
		const worker = this.workerManager.getNextWorker();
		return this.roomManager.createRoom(
			roomId,
			worker,
			mediasoupConfig.router.mediaCodecs,
		);
	}

	async closeRoom(roomId: string): Promise<void> {
		await this.roomManager.closeRoom(roomId);
	}

	async addPeer(
		roomId: string,
		peerId: string,
		peerInfo: PeerInfo = {
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
		const room = this.roomManager.getRoom(roomId)!;
		const peer = room.peers.get(peerId)!;

		const result = await this.producerManager.createProducer(
			transport,
			roomId,
			peerId,
			rtpParameters,
			kind,
			appData,
		);

		peer.producers.set(result.id, this.producerManager.getProducer(result.id)!);

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
		const room = this.roomManager.getRoom(roomId)!;

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

		const peer = room.peers.get(peerId)!;
		peer.consumers.set(result.id, this.consumerManager.getConsumer(result.id)!);

		return result;
	}

	closeProducer(producerId: string): CloseProducerResult {
		const result = this.producerManager.closeProducer(producerId);

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
