import type { Server, Socket } from 'socket.io';
import { describe, expect, it } from 'vitest';
import type { UserData } from '../../types';
import { RoomRegistry } from '../RoomRegistry';

function makeSocket(
	id: string,
): Socket & { emit: (e: string, d: unknown) => boolean } {
	const emitCalls: { event: string; data: unknown }[] = [];
	const sock = {
		id,
		emit(event: string, data?: unknown) {
			emitCalls.push({ event, data });
			return true;
		},
		_emitCalls: emitCalls,
	};
	return sock as unknown as Socket & {
		emit: (e: string, d: unknown) => boolean;
	};
}

function makeIo(): {
	io: Server;
	sockets: Map<string, ReturnType<typeof makeSocket>>;
} {
	const sockets = new Map<string, ReturnType<typeof makeSocket>>();
	const io = {
		sockets: { sockets, adapter: { rooms: new Map() } },
	} as unknown as Server;
	return { io, sockets };
}

describe('RoomRegistry', () => {
	describe('raised hands', () => {
		it('stores and clears timestamps per peer; hasRaisedHand reflects state', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);

			expect(registry.hasRaisedHand('r1', 'p1')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({});

			registry.setRaisedHand('r1', 'p1', '2026-01-01T00:00:00.000Z');
			registry.setRaisedHand('r1', 'p2', '2026-01-01T00:00:01.000Z');

			expect(registry.hasRaisedHand('r1', 'p1')).toBe(true);
			expect(registry.hasRaisedHand('r1', 'p2')).toBe(true);
			expect(registry.hasRaisedHand('r1', 'p3')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({
				p1: '2026-01-01T00:00:00.000Z',
				p2: '2026-01-01T00:00:01.000Z',
			});

			registry.clearRaisedHand('r1', 'p1');
			expect(registry.hasRaisedHand('r1', 'p1')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({
				p2: '2026-01-01T00:00:01.000Z',
			});

			registry.clearRaisedHand('r1', 'does-not-exist');
			expect(registry.getRaisedHands('r1')).toEqual({
				p2: '2026-01-01T00:00:01.000Z',
			});
		});
	});

	describe('host-only chat', () => {
		it('toggles the flag and isHostOnlyChat reads it back', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);

			expect(registry.isHostOnlyChat('r1')).toBe(false);
			registry.setHostOnlyChat('r1', true);
			expect(registry.isHostOnlyChat('r1')).toBe(true);
			registry.setHostOnlyChat('r1', false);
			expect(registry.isHostOnlyChat('r1')).toBe(false);
		});
	});

	describe('scope-based emit', () => {
		it('emitToFullAccessParticipants only reaches full sockets, not preview sockets', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);

			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitToFullAccessParticipants('r1', 'hello', { x: 1 });

			expect(full._emitCalls).toEqual([{ event: 'hello', data: { x: 1 } }]);
			expect(preview._emitCalls).toEqual([]);
		});

		it('emitToPreviewParticipants only reaches preview sockets, not full sockets', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);

			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitToPreviewParticipants('r1', 'hi', { y: 2 });

			expect(preview._emitCalls).toEqual([{ event: 'hi', data: { y: 2 } }]);
			expect(full._emitCalls).toEqual([]);
		});

		it('removeSocket clears the socket from both scopes', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const s = makeSocket('s-1');
			sockets.set(s.id, s);
			registry.addFullAccessSocket('r1', s.id);
			registry.addPreviewSocket('r1', s.id);
			expect(registry.isEmpty('r1')).toBe(false);

			registry.removeSocket('r1', s.id);
			expect(registry.isEmpty('r1')).toBe(true);
		});

		it('emitToScope is a no-op when the room has no sockets', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);
			expect(() =>
				registry.emitToFullAccessParticipants('nope', 'x', { ok: true }),
			).not.toThrow();
		});
	});

	describe('emitParticipantEvent', () => {
		const userData: UserData = {
			name: 'Alice',
			userId: 'u-1',
			avatar: 'a.png',
			is_guest: false,
		};

		it('participant_joined sends full userData to full sockets and a stripped payload to preview sockets', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);
			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitParticipantEvent(
				'r1',
				'participant_joined',
				'u-1',
				userData,
			);

			expect(full._emitCalls).toEqual([
				{
					event: 'participant_joined',
					data: { roomId: 'r1', participantId: 'u-1', userData },
				},
			]);
			expect(preview._emitCalls).toEqual([
				{
					event: 'participant_joined',
					data: {
						roomId: 'r1',
						participantId: 'u-1',
						userData: { name: 'Alice', avatar: 'a.png' },
					},
				},
			]);
		});

		it('participant_joined for a preview-* id only emits to full sockets (preview sockets get nothing)', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);
			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitParticipantEvent(
				'r1',
				'participant_joined',
				'preview-1',
				userData,
			);

			expect(full._emitCalls).toHaveLength(1);
			expect(preview._emitCalls).toEqual([]);
		});

		it('participant_left broadcasts to both full and preview sockets for a real participant', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);
			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitParticipantEvent('r1', 'participant_left', 'u-1');

			expect(full._emitCalls).toEqual([
				{
					event: 'participant_left',
					data: { roomId: 'r1', participantId: 'u-1' },
				},
			]);
			expect(preview._emitCalls).toEqual([
				{
					event: 'participant_left',
					data: { roomId: 'r1', participantId: 'u-1' },
				},
			]);
		});

		it('participant_left for a preview-* id only reaches full sockets', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			sockets.set(full.id, full);
			sockets.set(preview.id, preview);
			registry.addFullAccessSocket('r1', full.id);
			registry.addPreviewSocket('r1', preview.id);

			registry.emitParticipantEvent('r1', 'participant_left', 'preview-1');

			expect(full._emitCalls).toHaveLength(1);
			expect(preview._emitCalls).toEqual([]);
		});
	});

	describe('cleanupRoom', () => {
		it('clears sockets, raised hands, and host-only chat flag for the room', () => {
			const { io, sockets } = makeIo();
			const registry = new RoomRegistry(io);

			const full = makeSocket('full-1');
			sockets.set(full.id, full);
			registry.addFullAccessSocket('r1', full.id);
			registry.setRaisedHand('r1', 'u-1', 'ts');
			registry.setHostOnlyChat('r1', true);

			registry.cleanupRoom('r1');

			expect(registry.isEmpty('r1')).toBe(true);
			expect(registry.getRaisedHands('r1')).toEqual({});
			expect(registry.isHostOnlyChat('r1')).toBe(false);
		});
	});
});
