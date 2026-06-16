import type { Server, Socket } from 'socket.io';
import type { ServerToClientEvents, UserData } from '../types';

export class RoomRegistry {
	private io: Server<ClientToServerEventsShim, ServerToClientEvents>;
	private fullAccessSockets: Map<string, Set<string>> = new Map();
	private previewSockets: Map<string, Set<string>> = new Map();
	private raisedHands: Record<string, Record<string, string>> = {};
	private hostOnlyChat: Record<string, boolean> = {};

	constructor(io: Server<ClientToServerEventsShim, ServerToClientEvents>) {
		this.io = io;
	}

	addFullAccessSocket(roomId: string, socketId: string): void {
		const set = this.fullAccessSockets.get(roomId) ?? new Set<string>();
		set.add(socketId);
		this.fullAccessSockets.set(roomId, set);
	}

	addPreviewSocket(roomId: string, socketId: string): void {
		const set = this.previewSockets.get(roomId) ?? new Set<string>();
		set.add(socketId);
		this.previewSockets.set(roomId, set);
	}

	removeSocket(roomId: string, socketId: string): void {
		this.fullAccessSockets.get(roomId)?.delete(socketId);
		this.previewSockets.get(roomId)?.delete(socketId);
	}

	getFullAccessSocketIds(roomId: string): string[] {
		return Array.from(this.fullAccessSockets.get(roomId) ?? []);
	}

	getPreviewSocketIds(roomId: string): string[] {
		return Array.from(this.previewSockets.get(roomId) ?? []);
	}

	setRaisedHand(roomId: string, peerId: string, isoTimestamp: string): void {
		if (!this.raisedHands[roomId]) this.raisedHands[roomId] = {};
		this.raisedHands[roomId][peerId] = isoTimestamp;
	}

	clearRaisedHand(roomId: string, peerId: string): void {
		delete this.raisedHands[roomId]?.[peerId];
	}

	getRaisedHands(roomId: string): Record<string, string> {
		return this.raisedHands[roomId] ?? {};
	}

	hasRaisedHand(roomId: string, peerId: string): boolean {
		return Boolean(this.raisedHands[roomId]?.[peerId]);
	}

	setHostOnlyChat(roomId: string, enabled: boolean): void {
		this.hostOnlyChat[roomId] = enabled;
	}

	isHostOnlyChat(roomId: string): boolean {
		return Boolean(this.hostOnlyChat[roomId]);
	}

	getRoomStats(roomId: string): {
		fullAccessCount: number;
		previewCount: number;
		isEmpty: boolean;
	} {
		const fullAccessCount = this.fullAccessSockets.get(roomId)?.size ?? 0;
		const previewCount = this.previewSockets.get(roomId)?.size ?? 0;
		return {
			fullAccessCount,
			previewCount,
			isEmpty: fullAccessCount === 0 && previewCount === 0,
		};
	}

	cleanupRoom(roomId: string): void {
		this.fullAccessSockets.delete(roomId);
		this.previewSockets.delete(roomId);
		delete this.raisedHands[roomId];
		delete this.hostOnlyChat[roomId];
	}

	emitToFullAccessParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) emitToSocket(socket, event, data);
		}
	}

	emitToPreviewParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		const socketIds = this.previewSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) emitToSocket(socket, event, data);
		}
	}

	emitParticipantEvent(
		roomId: string,
		event: 'participant_joined' | 'participant_left',
		participantId: string,
		userData?: UserData,
	): void {
		if (event === 'participant_joined' && userData) {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
				userData,
			});
		} else if (event === 'participant_left') {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
			});
		}

		if (!participantId.startsWith('preview-')) {
			if (event === 'participant_joined' && userData) {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
					userData: {
						name: userData.name,
						avatar: userData.avatar,
					} as UserData,
				});
			} else if (event === 'participant_left') {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
				});
			}
		}
	}
}

type ClientToServerEventsShim = Record<string, (...args: unknown[]) => void>;

function emitToSocket(socket: Socket, event: string, data: unknown): void {
	(socket as unknown as { emit: (e: string, d: unknown) => boolean }).emit(
		event,
		data,
	);
}
