import * as crypto from 'node:crypto';

interface PreviewSession {
	sessionId: string;
	token: string;
	meetingId: string;
	userId: string;
	expiresAt: number;
	used: boolean;
	ipAddress?: string;
	userAgent?: string;
	createdAt: number;
	lastUsedAt?: number;
}

export class PreviewSessionManager {
	private sessions: Map<string, PreviewSession> = new Map();
	private cleanupInterval: NodeJS.Timeout;

	constructor(cleanupIntervalMs: number = 60 * 1000) {
		this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
	}

	/**
	 * Create a new preview session
	 */
	createSession(
		token: string,
		meetingId: string,
		userId: string,
		ipAddress?: string,
		userAgent?: string,
	): PreviewSession {
		const sessionId = crypto.randomUUID();
		const session: PreviewSession = {
			sessionId,
			token,
			meetingId,
			userId,
			expiresAt: Date.now() + 300000, // 5 minutes
			used: false,
			ipAddress,
			userAgent,
			createdAt: Date.now(),
		};

		this.sessions.set(sessionId, session);
		return session;
	}

	validateAndUseSession(
		sessionId: string,
		token: string,
		ipAddress?: string,
		_userAgent?: string,
	): { valid: boolean; session?: PreviewSession; reason?: string } {
		const session = this.sessions.get(sessionId);

		if (!session) {
			return { valid: false, reason: 'Session not found' };
		}

		// Check if session has expired
		if (Date.now() > session.expiresAt) {
			this.sessions.delete(sessionId);
			return { valid: false, reason: 'Session expired' };
		}

		// Check if session already used
		if (session.used) {
			return { valid: false, reason: 'Session already used' };
		}

		// Validate token matches
		if (session.token !== token) {
			return { valid: false, reason: 'Token mismatch' };
		}

		// Validate IP address consistency
		if (session.ipAddress && ipAddress && session.ipAddress !== ipAddress) {
			return { valid: false, reason: 'IP address mismatch' };
		}

		// Mark session as used
		session.used = true;
		session.lastUsedAt = Date.now();

		return { valid: true, session };
	}

	getSession(sessionId: string): PreviewSession | undefined {
		return this.sessions.get(sessionId);
	}

	markSessionAsUsed(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		session.used = true;
		session.lastUsedAt = Date.now();
		return true;
	}

	getStats(): {
		totalSessions: number;
		activeSessions: number;
		usedSessions: number;
	} {
		const now = Date.now();
		let activeSessions = 0;
		let usedSessions = 0;

		for (const session of this.sessions.values()) {
			if (now <= session.expiresAt) {
				activeSessions++;
				if (session.used) {
					usedSessions++;
				}
			}
		}

		return {
			totalSessions: this.sessions.size,
			activeSessions,
			usedSessions,
		};
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [sessionId, session] of this.sessions.entries()) {
			if (now > session.expiresAt) {
				this.sessions.delete(sessionId);
			}
		}
	}

	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.sessions.clear();
	}
}
