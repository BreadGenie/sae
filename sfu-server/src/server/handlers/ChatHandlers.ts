import type { Socket } from 'socket.io';
import type { ChatMessage } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';

export class ChatHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('chat:toggle_restriction', (data) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;

				if (!roomId || (!socket.isHost && !socket.isCohost)) return;
				const isRestricted = Boolean(data.enabled);
				this.deps.registry.setHostOnlyChat(roomId, isRestricted);

				this.deps.registry.emitToFullAccessParticipants(
					roomId,
					'chat:restriction_updated',
					{ enabled: isRestricted },
				);
			} catch (error) {
				loggers.socketHandler.warn('chat:toggle failed', error);
			}
		});

		socket.on('chat:send', (data = {}) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
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

				if (
					this.deps.registry.isHostOnlyChat(roomId) &&
					!socket.isHost &&
					!socket.isCohost
				) {
					socket.emit('sfu_error', {
						error: 'Only hosts and co-hosts can send messages right now.',
						code: 'HOST_ONLY_CHAT',
						timestamp: new Date().toISOString(),
					});
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

				this.deps.registry.emitToFullAccessParticipants(
					roomId,
					'chat:message',
					payload,
				);
			} catch (e) {
				loggers.socketHandler.warn(
					'chat:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	}
}
