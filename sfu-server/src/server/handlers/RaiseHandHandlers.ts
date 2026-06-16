import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';

export class RaiseHandHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('raise_hand', (data, callback) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const raised = typeof data?.raised === 'boolean' ? data.raised : false;

				if (!roomId || !socket.participantId) {
					callback({ success: false, error: 'Invalid room or participant' });
					return;
				}

				if (raised) {
					this.deps.registry.setRaisedHand(
						roomId,
						socket.participantId,
						new Date().toISOString(),
					);
				} else {
					this.deps.registry.clearRaisedHand(roomId, socket.participantId);
				}

				this.deps.registry.emitToFullAccessParticipants(roomId, 'hand_raised', {
					participantId: socket.participantId,
					raised,
					timestamp: new Date().toISOString(),
				});

				callback({ success: true });
			} catch (e) {
				loggers.socketHandler.warn(
					'raise_hand handling failed: %s',
					(e as Error).message || e,
				);
				callback({ success: false, error: 'Internal error' });
			}
		});
	}
}
