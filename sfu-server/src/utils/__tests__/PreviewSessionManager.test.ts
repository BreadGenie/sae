import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewSessionManager } from '../previewSessionManager';

describe('PreviewSessionManager', () => {
	let now = 0;
	let manager: PreviewSessionManager;

	beforeEach(() => {
		now = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		manager = new PreviewSessionManager(60_000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		manager.destroy();
	});

	describe('createSession / getSession', () => {
		it('creates a session with a unique id and stores it', () => {
			const a = manager.createSession(
				'token-A',
				'meeting-1',
				'user-1',
				'1.1.1.1',
			);
			const b = manager.createSession(
				'token-B',
				'meeting-1',
				'user-1',
				'1.1.1.1',
			);

			expect(a.sessionId).not.toBe(b.sessionId);
			expect(manager.getSession(a.sessionId)).toBe(a);
			expect(manager.getSession('missing')).toBeUndefined();
			expect(a.token).toBe('token-A');
			expect(a.meetingId).toBe('meeting-1');
			expect(a.used).toBe(false);
			expect(a.expiresAt).toBe(now + 300_000);
		});
	});

	describe('validateAndUseSession', () => {
		it('rejects unknown sessions', () => {
			const result = manager.validateAndUseSession('nope', 't', '1.1.1.1');
			expect(result).toEqual({
				valid: false,
				reason: 'Session not found',
			});
		});

		it('rejects an expired session and removes it from the map', () => {
			const s = manager.createSession('t', 'm', 'u', '1.1.1.1');

			now += 300_001;

			const result = manager.validateAndUseSession(s.sessionId, 't', '1.1.1.1');
			expect(result.valid).toBe(false);
			expect(result.reason).toBe('Session expired');
			expect(manager.getSession(s.sessionId)).toBeUndefined();
		});

		it('rejects reuse of a session that was already used', () => {
			const s = manager.createSession('t', 'm', 'u', '1.1.1.1');

			const first = manager.validateAndUseSession(s.sessionId, 't', '1.1.1.1');
			expect(first.valid).toBe(true);

			const second = manager.validateAndUseSession(s.sessionId, 't', '1.1.1.1');
			expect(second.valid).toBe(false);
			expect(second.reason).toBe('Session already used');
		});

		it('rejects a token mismatch', () => {
			const s = manager.createSession('token-original', 'm', 'u', '1.1.1.1');

			const result = manager.validateAndUseSession(
				s.sessionId,
				'token-other',
				'1.1.1.1',
			);
			expect(result.valid).toBe(false);
			expect(result.reason).toBe('Token mismatch');
		});

		it('rejects an IP mismatch when the original was recorded with one', () => {
			const s = manager.createSession('t', 'm', 'u', '1.1.1.1');

			const result = manager.validateAndUseSession(s.sessionId, 't', '2.2.2.2');
			expect(result.valid).toBe(false);
			expect(result.reason).toBe('IP address mismatch');
		});

		it('skips IP check when the original session had no IP recorded', () => {
			const s = manager.createSession('t', 'm', 'u');

			const result = manager.validateAndUseSession(s.sessionId, 't', '1.1.1.1');
			expect(result.valid).toBe(true);
		});

		it('marks the session as used and updates lastUsedAt on success', () => {
			const s = manager.createSession('t', 'm', 'u', '1.1.1.1');
			expect(s.used).toBe(false);

			now += 1000;
			const result = manager.validateAndUseSession(s.sessionId, 't', '1.1.1.1');
			expect(result.valid).toBe(true);
			expect(result.session?.used).toBe(true);
			expect(result.session?.lastUsedAt).toBe(now);
		});
	});

	describe('markSessionAsUsed', () => {
		it('returns false for unknown sessions and true after marking', () => {
			expect(manager.markSessionAsUsed('nope')).toBe(false);

			const s = manager.createSession('t', 'm', 'u', '1.1.1.1');
			expect(manager.markSessionAsUsed(s.sessionId)).toBe(true);
			expect(manager.getSession(s.sessionId)?.used).toBe(true);
		});
	});

	describe('getStats', () => {
		it('counts total, active, and used correctly', () => {
			const a = manager.createSession('t1', 'm', 'u1');
			manager.markSessionAsUsed(a.sessionId);

			manager.createSession('t2', 'm', 'u2');
			manager.createSession('t3', 'm', 'u3');

			now += 300_001;

			const stats = manager.getStats();
			expect(stats.totalSessions).toBe(3);
			expect(stats.activeSessions).toBe(0);
			expect(stats.usedSessions).toBe(0);
		});

		it('counts sessions as active while they are within the window', () => {
			const used = manager.createSession('t1', 'm', 'u1');
			manager.markSessionAsUsed(used.sessionId);
			manager.createSession('t2', 'm', 'u2');

			now += 1000;

			const stats = manager.getStats();
			expect(stats.totalSessions).toBe(2);
			expect(stats.activeSessions).toBe(2);
			expect(stats.usedSessions).toBe(1);
		});
	});

	describe('cleanup', () => {
		it('removes only expired sessions from the map', () => {
			const a = manager.createSession('t1', 'm', 'u1');
			const b = manager.createSession('t2', 'm', 'u2');
			now += 300_001;
			manager.createSession('t3', 'm', 'u3');

			manager['cleanup']();

			expect(manager.getSession(a.sessionId)).toBeUndefined();
			expect(manager.getSession(b.sessionId)).toBeUndefined();
			expect(manager.getStats().totalSessions).toBe(1);
		});
	});
});
