import type { Server, Socket } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
import { AuthHandlers } from './handlers/AuthHandlers';
import { ChatHandlers } from './handlers/ChatHandlers';
import { ConsumerHandlers } from './handlers/ConsumerHandlers';
import { DisconnectHandlers } from './handlers/DisconnectHandlers';
import { ErrorHandlers } from './handlers/ErrorHandlers';
import type { HandlerDeps } from './handlers/Handler';
import { HostControlHandlers } from './handlers/HostControlHandlers';
import { MediaControlHandlers } from './handlers/MediaControlHandlers';
import { ProducerHandlers } from './handlers/ProducerHandlers';
import { RaiseHandHandlers } from './handlers/RaiseHandHandlers';
import { ReactionHandlers } from './handlers/ReactionHandlers';
import { RoomJoinHandlers } from './handlers/RoomJoinHandlers';
import { RoomQueryHandlers } from './handlers/RoomQueryHandlers';
import { ScreenShareHandlers } from './handlers/ScreenShareHandlers';
import { WebRtcTransportHandlers } from './handlers/WebRtcTransportHandlers';
import { RoomRegistry } from './RoomRegistry';

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private registry: RoomRegistry;
	private rateLimiter: RateLimiter;
	private handlers: Array<{ register: (socket: Socket) => void }>;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
		this.rateLimiter = new RateLimiter();
		this.registry = new RoomRegistry(io);

		const deps: HandlerDeps = {
			io,
			registry: this.registry,
			mediasoup,
			authManager,
			rateLimiter: this.rateLimiter,
		};

		this.handlers = [
			new AuthHandlers(deps),
			new RoomJoinHandlers(deps),
			new RoomQueryHandlers(deps),
			new WebRtcTransportHandlers(deps),
			new ProducerHandlers(deps),
			new ConsumerHandlers(deps),
			new MediaControlHandlers(deps),
			new HostControlHandlers(deps),
			new ScreenShareHandlers(deps),
			new ChatHandlers(deps),
			new ReactionHandlers(deps),
			new RaiseHandHandlers(deps),
			new DisconnectHandlers(deps),
			new ErrorHandlers(deps),
		];

		this.mediasoup.onNetworkQualityUpdate((roomId, peerId, quality) => {
			this.registry.emitToFullAccessParticipants(
				roomId,
				'network_quality_update',
				{
					participantId: peerId,
					quality,
				},
			);
		});
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
			socket.use((_packet, next) => {
				if (this.authManager.isTokenExpired(socket)) {
					this.authManager.triggerTokenExpiry(socket, 'middleware_guard');
					return;
				}
				next();
			});

			for (const handler of this.handlers) {
				handler.register(socket);
			}
		});
	}
}
