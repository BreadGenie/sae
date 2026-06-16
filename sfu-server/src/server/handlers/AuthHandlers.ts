import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';

export class AuthHandlers implements SocketHandler {
	register(socket: Socket): void {
		socket.on('auth:update_token', (data, callback) => {
			try {
				const token = typeof data?.token === 'string' ? data.token : null;
				if (!token) {
					callback({ success: false, error: 'Missing token' });
					return;
				}

				this.deps.authManager.updateSocketToken(socket, token);
				callback({ success: true });
			} catch (error) {
				const message = (error as Error).message || 'Token update failed';
				loggers.socketHandler.warn(
					'auth:update_token failed for socket %s: %s',
					socket.id,
					message,
				);
				callback({ success: false, error: message });
				this.deps.authManager.triggerTokenExpiry(
					socket,
					'invalid_refresh_token',
				);
			}
		});
	}

	constructor(private deps: HandlerDeps) {}
}
