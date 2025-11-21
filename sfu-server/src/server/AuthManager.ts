import * as jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import type { JWTPayload } from '../types';
import { loggers } from '../utils/logger';

export class AuthManager {
	private jwtSecret: string;

	constructor(jwtSecret: string) {
		this.jwtSecret = jwtSecret;
	}

	authenticateSocket(socket: Socket): boolean {
		try {
			const token = socket.handshake.auth.token || socket.handshake.query.token;

			if (!token) {
				loggers.authManager.error('No authentication token provided');
				return false;
			}

			const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;

			// Attach user info to socket
			socket.userId = decoded.user_id;
			socket.userName = decoded.user_name;
			socket.meetingId = decoded.meeting_id;
			socket.isHost = decoded.is_host || false;
			socket.currentToken = token;
			socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : undefined;
			this.scheduleTokenExpiry(socket);

			loggers.authManager.info(
				'Authenticated user: %s for meeting: %s',
				socket.userId,
				socket.meetingId,
			);
			return true;
		} catch (error) {
			loggers.authManager.error(
				'Authentication failed: %s',
				(error as Error).message,
			);
			return false;
		}
	}

	getUserAvatar(token: string): string | undefined {
		try {
			const decoded = jwt.decode(token) as JWTPayload;
			return decoded.user_avatar;
		} catch (_error) {
			return undefined;
		}
	}

	updateSocketToken(socket: Socket, token: string): void {
		const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;

		if (!decoded.meeting_id || decoded.meeting_id !== socket.meetingId) {
			throw new Error('Token meeting mismatch');
		}

		if (!decoded.user_id || decoded.user_id !== socket.userId) {
			throw new Error('Token user mismatch');
		}

		socket.currentToken = token;
		socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : undefined;

		if (socket.handshake?.auth) {
			socket.handshake.auth.token = token;
		}

		loggers.authManager.info(
			'Updated token for socket %s (user %s)',
			socket.id,
			socket.userId,
		);

		this.scheduleTokenExpiry(socket);
	}

	isTokenExpired(socket: Socket): boolean {
		if (!socket.tokenExpiresAt) {
			return false;
		}

		return Date.now() >= socket.tokenExpiresAt;
	}

	triggerTokenExpiry(socket: Socket, reason: string): void {
		if (socket.disconnected) {
			return;
		}

		this.clearTokenExpiry(socket);

		const timestamp = new Date().toISOString();

		loggers.authManager.warn(
			'Disconnecting socket %s (user %s) due to expired token (%s)',
			socket.id,
			socket.userId,
			reason,
		);

		try {
			socket.emit('auth:expired', {
				timestamp,
				reason,
			});
			socket.emit('sfu_error', {
				error: 'Authentication token expired',
				timestamp,
			});
		} catch (emitError) {
			loggers.authManager.warn(
				'Failed to emit auth:expired for socket %s: %s',
				socket.id,
				(emitError as Error).message,
			);
		}

		setImmediate(() => {
			if (!socket.disconnected) {
				socket.disconnect(true);
			}
		});
	}

	cleanupSocket(socket: Socket): void {
		this.clearTokenExpiry(socket);
		socket.currentToken = undefined;
		socket.tokenExpiresAt = undefined;
	}

	private scheduleTokenExpiry(socket: Socket): void {
		this.clearTokenExpiry(socket);

		if (!socket.tokenExpiresAt) {
			return;
		}

		const delay = socket.tokenExpiresAt - Date.now();

		if (delay <= 0) {
			this.triggerTokenExpiry(socket, 'expired_before_timer');
			return;
		}

		socket.tokenExpiryTimer = setTimeout(() => {
			this.triggerTokenExpiry(socket, 'timer_elapsed');
		}, delay);
	}

	private clearTokenExpiry(socket: Socket): void {
		if (socket.tokenExpiryTimer) {
			clearTimeout(socket.tokenExpiryTimer);
			socket.tokenExpiryTimer = undefined;
		}
	}
}
