import type { Server } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
import {
	AuthHandlers,
	ChatHandlers,
	ConsumerHandlers,
	DisconnectHandlers,
	ErrorHandlers,
	HostControlHandlers,
	MediaControlHandlers,
	ProducerHandlers,
	RaiseHandHandlers,
	ReactionHandlers,
	RoomJoinHandlers,
	RoomQueryHandlers,
	ScreenShareHandlers,
	WebRtcTransportHandlers,
} from './handlers';
import type { HandlerDeps, SocketHandler } from './handlers/Handler';
import { RoomRegistry } from './RoomRegistry';

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private registry: RoomRegistry;
	private rateLimiter: RateLimiter;
	private handlers: SocketHandler[];

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
			this.authManager.authenticateSocket(socket);
			next();
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
