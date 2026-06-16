import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';
import { isRealParticipant } from './utils';

export class DisconnectHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('disconnect', async () => {
			this.deps.authManager.cleanupSocket(socket);

			loggers.socketHandler.info(
				'Disconnected: %s (User: %s, Scope: %s)',
				socket.id,
				socket.participantId,
				socket.scope,
			);

			const roomId = socket.roomId;
			const participantId = socket.participantId;

			if (roomId && participantId) {
				try {
					this.deps.registry.removeSocket(roomId, socket.id);

					if (socket.scope === 'full') {
						await this.deps.mediasoup.removePeer(roomId, participantId);

						if (isRealParticipant(participantId)) {
							this.deps.registry.emitParticipantEvent(
								roomId,
								'participant_left',
								participantId,
							);
						}

						if (this.deps.registry.hasRaisedHand(roomId, participantId)) {
							this.deps.registry.clearRaisedHand(roomId, participantId);
							this.deps.registry.emitToFullAccessParticipants(
								roomId,
								'hand_raised',
								{
									participantId,
									raised: false,
									timestamp: new Date().toISOString(),
								},
							);
						}

						loggers.socketHandler.info(
							'Cleaned up user %s from room %s',
							participantId,
							roomId,
						);
					}

					if (this.deps.registry.isEmpty(roomId)) {
						this.deps.registry.cleanupRoom(roomId);
						this.deps.mediasoup.closeRoom(roomId);
					}
				} catch (error) {
					loggers.socketHandler.error('Error handling disconnect: %s', error);
				}
			}
		});
	}
}
