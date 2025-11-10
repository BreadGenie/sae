import type { Server, Socket } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type {
	ChatMessage,
	ClientToServerEvents,
	ReactionMessage,
	ServerToClientEvents,
	UserData,
} from '../types';
import { loggers } from '../utils/logger';
import type { AuthManager } from './AuthManager';

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
	}

	setupSocketHandlers(): void {
		this.io.use((socket, next) => {
			if (this.authManager.authenticateSocket(socket)) {
				next();
			} else {
				next(new Error('Authentication failed'));
			}
		});

		this.io.on('connection', (socket) => {
			loggers.socketHandler.info(
				'New authenticated connection: %s (User: %s)',
				socket.id,
				socket.userId,
			);

			socket.use((_packet, next) => {
				if (this.authManager.isTokenExpired(socket)) {
					this.authManager.triggerTokenExpiry(socket, 'middleware_guard');
					return;
				}

				next();
			});

			this.setupAuthHandlers(socket);

			this.setupRoomHandlers(socket);
			this.setupWebRTCHandlers(socket);
			this.setupMediaControlHandlers(socket);
			this.setupScreenShareHandlers(socket);
			this.setupChatHandlers(socket);
			this.setupReactionHandlers(socket);
			this.setupDisconnectHandlers(socket);
			this.setupErrorHandlers(socket);
		});
	}

	private setupAuthHandlers(socket: Socket): void {
		socket.on('auth:update_token', (data, callback) => {
			try {
				const token = typeof data?.token === 'string' ? data.token : null;
				if (!token) {
					callback({ success: false, error: 'Missing token' });
					return;
				}

				this.authManager.updateSocketToken(socket, token);
				callback({ success: true });
			} catch (error) {
				const message = (error as Error).message || 'Token update failed';
				loggers.socketHandler.warn(
					'auth:update_token failed for socket %s: %s',
					socket.id,
					message,
				);
				callback({ success: false, error: message });
				this.authManager.triggerTokenExpiry(socket, 'invalid_refresh_token');
			}
		});
	}

	private setupRoomHandlers(socket: Socket): void {
		socket.on('join_room', async (data, callback) => {
			try {
				const { roomId, userData, mediaState } = data;
				await this.handleJoinRoom(socket, {
					roomId,
					participantId: socket.userId,
					userData: {
						name: userData.name,
						userId: userData.userId,
						avatar: userData.avatar,
						audio_enabled: mediaState.audio_enabled,
						video_enabled: mediaState.video_enabled,
					},
				});
				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error joining room: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_router_rtp_capabilities', async (_data, callback) => {
			try {
				const roomId = socket.meetingId;

				loggers.socketHandler.debug(
					'Getting RTP capabilities for room: %s, user: %s',
					roomId,
					socket.userId,
				);

				const rtpCapabilities = this.mediasoup.getRouterRtpCapabilities(roomId);

				callback({ success: true, rtpCapabilities });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting RTP capabilities: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_existing_producers', async (_data, callback) => {
			try {
				const roomId = socket.meetingId;
				const userId = socket.userId;

				loggers.socketHandler.debug(
					'Getting existing producers for room: %s, user: %s',
					roomId,
					userId,
				);

				const producers = await this.mediasoup.getExistingProducers(
					roomId,
					userId,
				);

				callback({ success: true, producers });

				// Also emit producer_created events for each existing producer
				for (const producer of producers) {
					socket.emit('producer_created', {
						roomId: producer.roomId,
						producerId: producer.id,
						participantId: producer.user_id,
						kind: producer.kind,
						paused: producer.paused,
						isScreen: producer.isScreen,
					});
				}

				loggers.socketHandler.info(
					'Sent %d existing producers to %s',
					producers.length,
					userId,
				);
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting existing producers: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_room_participants', async (_data, callback) => {
			try {
				const roomId = socket.meetingId;
				const participants = this.mediasoup.getRoomParticipants(roomId);
				callback({ success: true, participants });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting room participants: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('leave_room', async (data = {}) => {
			const roomId = socket.roomId || data.roomId;
			const participantId = socket.participantId;
			if (roomId && participantId) {
				try {
					await this.mediasoup.removePeer(roomId, participantId);
					socket.to(roomId).emit('participant_left', { roomId, participantId });
					socket.leave(roomId);
					socket.roomId = undefined;
					loggers.socketHandler.info('%s left room %s', participantId, roomId);
				} catch (e) {
					loggers.socketHandler.warn(
						'leave_room cleanup failed: %s',
						(e as Error).message,
					);
				}
			}
		});
	}

	private async handleJoinRoom(
		socket: Socket,
		data: { roomId: string; participantId: string; userData: UserData },
	): Promise<void> {
		const { roomId, participantId, userData } = data;

		try {
			await this.mediasoup.createRoom(roomId, (roomId, participantIds) => {
				this.io.to(roomId).emit('active_speaker', { participantIds });
			});

			this.mediasoup.addPeer(roomId, participantId, userData);

			socket.join(roomId);

			socket.meetingId = roomId;
			socket.roomId = roomId;
			socket.participantId = participantId;

			socket.to(roomId).emit('participant_joined', {
				roomId,
				participantId,
				userData,
			});

			loggers.socketHandler.info(
				'User %s joined room %s with media state: audio=%s, video=%s',
				participantId,
				roomId,
				userData.audio_enabled,
				userData.video_enabled,
			);
		} catch (error) {
			loggers.socketHandler.error(
				'Error in handleJoinRoom for user %s: %s',
				participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	private setupWebRTCHandlers(socket: Socket): void {
		socket.on('create_webrtc_transport', async (data, callback) => {
			try {
				const { direction } = data;
				const roomId = socket.meetingId;
				const userId = socket.userId;

				const transportParams = await this.mediasoup.createWebRtcTransport(
					roomId,
					userId,
					direction,
				);

				callback({ success: true, ...transportParams });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('connect_webrtc_transport', async (data, callback) => {
			try {
				const { transportId, dtlsParameters } = data;
				await this.mediasoup.connectWebRtcTransport(
					transportId,
					dtlsParameters,
				);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error connecting WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_producer', async (data, callback) => {
			try {
				const { transportId, rtpParameters, kind, appData = {} } = data;
				const producer = await this.mediasoup.createProducer(
					transportId,
					rtpParameters,
					kind,
					appData,
				);

				const isScreen =
					(producer.appData && producer.appData.type === 'screen') ||
					appData.type === 'screen';

				callback({ success: true, ...producer, isScreen });

				const roomId = socket.meetingId;
				socket.to(roomId).emit('producer_created', {
					roomId: roomId,
					participantId: socket.userId,
					producerId: producer.id,
					kind: producer.kind,
					paused: false, // New producers start unpaused
					isScreen: isScreen,
				});
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_consumer', async (data, callback) => {
			try {
				const { transportId, producerId, rtpCapabilities } = data;
				const consumer = await this.mediasoup.createConsumer(
					transportId,
					producerId,
					rtpCapabilities,
				);

				callback({ success: true, ...consumer });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				const { producerId } = data;
				const result = this.mediasoup.closeProducer(producerId);

				callback({ success: true, ...result });

				const roomId = socket.meetingId;
				socket.to(roomId).emit('producer_closed', {
					roomId: roomId,
					participantId: socket.userId,
					producerId,
					isScreen: !!result.isScreen,
				});

				try {
					for (const rc of result.removedConsumers) {
						const targetPeerSocket = Array.from(
							this.io.sockets.sockets.values(),
						).find((s) => s.userId === rc.peerId && s.meetingId === rc.roomId);
						if (targetPeerSocket) {
							targetPeerSocket.emit('consumer_closed', {
								consumerId: rc.consumerId,
							});
						} else {
							socket.to(roomId).emit('consumer_closed', {
								consumerId: rc.consumerId,
								peerId: rc.peerId,
							});
						}
					}
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to emit consumer_closed notifications: %s',
						(e as Error).message,
					);
				}
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_consumer', async (data, callback) => {
			try {
				const { consumerId } = data;
				await this.mediasoup.closeConsumer(consumerId);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('consumer:update_preferences', async (data, callback) => {
			try {
				const consumerId = data?.consumerId;
				if (!consumerId) {
					callback({ success: false, error: 'Missing consumerId' });
					return;
				}

				const visible = Boolean(data.visible);
				const width = Math.round(data.width);
				const height = Math.round(data.height);

				const result = await this.mediasoup.updateConsumerPreferences({
					consumerId,
					visible,
					width,
					height,
				});

				callback({ success: true, ...result, visible });
			} catch (error) {
				loggers.socketHandler.warn(
					'Error updating consumer preferences: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	}

	private setupMediaControlHandlers(socket: Socket): void {
		socket.on('media_control', async (data) => {
			const { action } = data;
			const roomId = socket.roomId;

			if (!roomId || !socket.participantId) return;

			try {
				this.mediasoup.applyMediaControl(roomId, socket.participantId, action);
			} catch (e) {
				loggers.socketHandler.warn(
					'Failed to apply media control on server: %s',
					(e as Error).message,
				);
			}

			socket.to(roomId).emit('media_control_update', {
				participantId: socket.participantId,
				action,
				timestamp: new Date().toISOString(),
			});
		});
	}

	private setupScreenShareHandlers(socket: Socket): void {
		socket.on('screen_share', (data) => {
			const { action, shareData } = data;
			const roomId = socket.roomId;

			if (!roomId) return;

			if (action === 'start_share') {
				socket.to(roomId).emit('screen_share_started', {
					participantId: socket.participantId,
					shareData,
					timestamp: new Date().toISOString(),
				});
			} else if (action === 'stop_share') {
				socket.to(roomId).emit('screen_share_stopped', {
					participantId: socket.participantId,
					timestamp: new Date().toISOString(),
				});
			}
		});
	}

	private setupChatHandlers(socket: Socket): void {
		socket.on('chat:send', (data = {}) => {
			try {
				const roomId = socket.roomId;
				const text = (
					typeof data.message === 'string' ? data.message : ''
				).slice(0, 2000);

				if (
					!roomId ||
					!text.trim() ||
					!socket.participantId ||
					!socket.userName
				) {
					return;
				}

				const payload: ChatMessage = {
					roomId,
					message: text,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};
				if (data.clientId) payload.clientId = String(data.clientId);

				socket.to(roomId).emit('chat:message', payload);
			} catch (e) {
				loggers.socketHandler.warn(
					'chat:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	}

	private setupReactionHandlers(socket: Socket): void {
		socket.on('reaction:send', (data = {}) => {
			try {
				const roomId = socket.roomId;
				const reaction =
					typeof data.reaction === 'string' ? data.reaction : null;

				if (!roomId || !reaction || !socket.participantId) {
					return;
				}

				const payload: ReactionMessage = {
					roomId,
					reaction,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};

				socket.to(roomId).emit('reaction:message', payload);
			} catch (e) {
				loggers.socketHandler.warn(
					'reaction:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	}

	private setupDisconnectHandlers(socket: Socket): void {
		socket.on('disconnect', async () => {
			this.authManager.cleanupSocket(socket);

			loggers.socketHandler.info(
				'Disconnected: %s (User: %s)',
				socket.id,
				socket.participantId,
			);

			const roomId = socket.roomId;
			const participantId = socket.participantId;

			if (roomId && participantId) {
				try {
					await this.mediasoup.removePeer(roomId, participantId);

					socket.to(roomId).emit('participant_left', {
						roomId: roomId,
						participantId: participantId,
					});

					loggers.socketHandler.info(
						'Cleaned up user %s from room %s',
						participantId,
						roomId,
					);
				} catch (error) {
					loggers.socketHandler.error('Error handling disconnect: %s', error);
				}
			}
		});
	}

	private setupErrorHandlers(socket: Socket): void {
		socket.on('error', (error) => {
			loggers.socketHandler.error('Socket error for %s: %s', socket.id, error);
			socket.emit('sfu_error', {
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
			});
		});
	}
}
