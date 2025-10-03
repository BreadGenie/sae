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
}
