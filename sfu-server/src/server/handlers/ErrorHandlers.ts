import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';

export class ErrorHandlers implements SocketHandler {
	constructor(_deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('error', (error) => {
			loggers.socketHandler.error('Socket error for %s: %s', socket.id, error);
			socket.emit('sfu_error', {
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
			});
		});
	}
}
