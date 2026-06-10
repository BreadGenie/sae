import type { Server, Socket } from 'socket.io';
import type {
	ClientToServerEvents,
	E2eeEpochEnvelope,
	ServerToClientEvents,
	SocketData,
} from '../types';
import { loggers } from '../utils/logger';
import type { E2eeRosterStore } from './E2eeRosterStore';

type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

type E2eeEpochPayload = {
	type?: unknown;
	epochNumber?: unknown;
	nextEpochNumber?: unknown;
	previousEpochNumber?: unknown;
	knownEpochNumber?: unknown;
	reason?: unknown;
	fromParticipantId?: unknown;
	fromSenderId?: unknown;
	toParticipantId?: unknown;
	toSenderId?: unknown;
	committerSenderId?: unknown;
	joiningSenderIds?: unknown;
	removedSenderIds?: unknown;
	membershipDeltaId?: unknown;
	membershipDeltaHash?: unknown;
	rosterHash?: unknown;
	keyPackage?: unknown;
	mlsCommit?: unknown;
	mlsWelcome?: unknown;
};

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const HASH_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_OPAQUE_MLS_BYTES = 64 * 1024;
const MAX_DELTA_ID_LENGTH = 128;
const SENDER_ID_MAX = 0xffffffff;
const RETAINED_EPOCHS = 3;

type RetainedEpochMaterial = {
	commit?: Extract<E2eeEpochEnvelope, { type: 'commit' }>;
	welcomes: Map<number, Extract<E2eeEpochEnvelope, { type: 'welcome' }>>;
	acks: Map<number, Set<number>>;
};

export class E2EEEpochRelay {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private fullAccessSockets: Map<string, Set<string>>;
	private participantToSender: Map<string, Map<string, number>>;
	private roster: E2eeRosterStore | null = null;
	private retainedMaterial = new Map<
		string,
		Map<number, RetainedEpochMaterial>
	>();
	private currentEpochByRoom = new Map<string, number>();

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		fullAccessSockets: Map<string, Set<string>>,
		participantToSender: Map<string, Map<string, number>>,
	) {
		this.io = io;
		this.fullAccessSockets = fullAccessSockets;
		this.participantToSender = participantToSender;
	}

	setRoster(roster: E2eeRosterStore): void {
		this.roster = roster;
	}

	setup(socket: Socket): void {
		socket.on('e2ee:epoch', (payload: E2eeEpochPayload) => {
			void this.handle(socket, payload);
		});
	}

	requestKeyPackages(
		roomId: string,
		epochNumber: number,
		reason: 'enable' | 'join' | 'reconnect',
	): void {
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package-request',
			epochNumber,
			reason,
		});
	}

	requestKeyPackageFromParticipant(
		roomId: string,
		participantId: string,
		epochNumber: number,
		reason: 'join' | 'reconnect',
	): void {
		console.log('[DEBUG-e2ee] SFU: targeted key-package-request', {
			roomId,
			participantId,
			epochNumber,
			reason,
		});
		this.emitToTarget(roomId, participantId, {
			type: 'key-package-request',
			epochNumber,
			reason,
		});
	}

	getCurrentEpochNumber(roomId: string): number {
		return this.currentEpochByRoom.get(roomId) ?? 1;
	}

	clearRoom(roomId: string): void {
		this.currentEpochByRoom.delete(roomId);
		this.retainedMaterial.delete(roomId);
	}

	private async handle(
		socket: Socket,
		payload: E2eeEpochPayload,
	): Promise<void> {
		try {
			if (socket.scope !== 'full') return;
			const roomId = socket.roomId;
			const fromParticipantId = socket.participantId;
			const fromSenderId = socket.senderId;
			console.log('[DEBUG-e2ee] SFU: epoch envelope received', {
				type: payload.type,
				roomId,
				fromParticipantId,
				fromSenderId,
				isHost: socket.isHost,
			});
			if (!roomId || !fromParticipantId || fromSenderId === undefined) return;

			switch (payload.type) {
				case 'key-package-request':
					this.relayKeyPackageRequest(roomId, payload);
					return;
				case 'key-package':
					await this.relayKeyPackage(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
					);
					return;
				case 'commit-request':
					this.relayCommitRequest(roomId, payload);
					return;
				case 'commit':
					await this.relayCommit(
						roomId,
						fromParticipantId,
						fromSenderId,
						payload,
					);
					return;
				case 'welcome':
					this.relayWelcome(roomId, fromParticipantId, fromSenderId, payload);
					return;
				case 'ack':
					this.recordAck(roomId, fromParticipantId, fromSenderId, payload);
					return;
				case 'resync-request':
					await this.replayRetainedMaterial(roomId, fromSenderId, payload);
					return;
			}
		} catch (error) {
			loggers.socketHandler.warn(
				'e2ee:epoch relay failed: %s',
				(error as Error).message,
			);
		}
	}

	private relayKeyPackageRequest(
		roomId: string,
		payload: E2eeEpochPayload,
	): void {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isKeyPackageReason(payload.reason)
		) {
			return;
		}
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package-request',
			epochNumber: payload.epochNumber,
			reason: payload.reason,
		});
	}

	private async relayKeyPackage(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isOpaqueMlsBytes(payload.keyPackage)
		) {
			console.warn('[DEBUG-e2ee] SFU: key-package rejected by validation', {
				roomId,
				fromParticipantId,
				fromSenderId,
				epochNumber: payload.epochNumber,
			});
			return;
		}
		console.log(
			'[DEBUG-e2ee] SFU: relaying key-package and requesting host commit',
			{
				roomId,
				fromParticipantId,
				fromSenderId,
				epochNumber: payload.epochNumber,
			},
		);
		this.emitToFullAccessParticipants(roomId, {
			type: 'key-package',
			fromParticipantId,
			fromSenderId,
			epochNumber: payload.epochNumber,
			keyPackage: payload.keyPackage,
		});
		await this.requestCommitFromHost(
			roomId,
			[fromSenderId],
			payload.epochNumber,
		);
	}

	private async requestCommitFromHost(
		roomId: string,
		joiningSenderIds: number[],
		epochNumber: number,
	): Promise<void> {
		if (joiningSenderIds.length === 0) {
			console.warn('[DEBUG-e2ee] SFU: no joiners to add', { roomId });
			return;
		}
		// Pick a current epoch member to author the commit. Prefer host if
		// online; else oldest current member online. Roster picker ignores
		// the joiners.
		const picked =
			(await this.roster?.pickCommitter(roomId, joiningSenderIds)) ?? null;
		const hostSocket = this.findHostSocket(roomId);
		const hostExcluded = picked
			? hostSocket?.senderId === undefined ||
				hostSocket.senderId !== picked.senderId
			: true;
		console.log('[DEBUG-e2ee] SFU: requestCommitFromHost picker', {
			roomId,
			joiningSenderIds,
			epochNumber,
			pickedSenderId: picked?.senderId ?? null,
			pickedIsHost: picked?.isHost ?? null,
			hostFound: !!hostSocket,
			hostOnline: !hostExcluded,
		});
		if (!picked) {
			console.warn('[DEBUG-e2ee] SFU: no committer available', {
				roomId,
				joiningSenderIds,
			});
			return;
		}
		const nextEpochNumber = epochNumber + 1;
		const sortedIds = [...joiningSenderIds].sort((a, b) => a - b);
		const membershipDeltaId = `add-${sortedIds.join('-')}-to-${nextEpochNumber}`;
		const membershipDeltaHash = Buffer.from(
			JSON.stringify({
				type: 'add',
				senderIds: sortedIds,
				nextEpochNumber,
			}),
		).toString('base64');
		this.emitToTarget(roomId, picked.participantId, {
			type: 'commit-request',
			epochNumber,
			nextEpochNumber,
			membershipDeltaId,
			membershipDeltaHash,
			rosterHash: membershipDeltaHash,
			committerSenderId: picked.senderId,
			joiningSenderIds: sortedIds,
		});
	}

	/**
	 * Ask the roster to pick a committer to author a remove-only commit
	 * (e.g. host kicked a participant). The committer's tab runs the
	 * EpochProtocolProvider.removeMember path. Returns true if a committer
	 * was found and a commit-request was emitted.
	 */
	async requestCommitForRemoval(
		roomId: string,
		removedSenderIds: number[],
		epochNumber: number,
	): Promise<boolean> {
		if (removedSenderIds.length === 0) {
			console.warn('[DEBUG-e2ee] SFU: no removals requested', { roomId });
			return false;
		}
		const picked =
			(await this.roster?.pickCommitter(roomId, removedSenderIds)) ?? null;
		if (!picked) {
			console.warn('[DEBUG-e2ee] SFU: no committer for removal', {
				roomId,
				removedSenderIds,
			});
			return false;
		}
		const nextEpochNumber = epochNumber + 1;
		const sortedIds = [...removedSenderIds].sort((a, b) => a - b);
		const membershipDeltaId = `remove-${sortedIds.join('-')}-to-${nextEpochNumber}`;
		const membershipDeltaHash = Buffer.from(
			JSON.stringify({
				type: 'remove',
				senderIds: sortedIds,
				nextEpochNumber,
			}),
		).toString('base64');
		this.emitToTarget(roomId, picked.participantId, {
			type: 'commit-request',
			epochNumber,
			nextEpochNumber,
			membershipDeltaId,
			membershipDeltaHash,
			rosterHash: membershipDeltaHash,
			committerSenderId: picked.senderId,
			joiningSenderIds: [],
			removedSenderIds: sortedIds,
		});
		return true;
	}

	private relayCommitRequest(roomId: string, payload: E2eeEpochPayload): void {
		if (
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isEpochNumber(payload.nextEpochNumber) ||
			payload.nextEpochNumber !== payload.epochNumber + 1 ||
			!this.isDeltaId(payload.membershipDeltaId) ||
			!this.isHash(payload.membershipDeltaHash) ||
			!this.isHash(payload.rosterHash) ||
			!this.isSenderId(payload.committerSenderId) ||
			!this.isSenderIdArray(payload.joiningSenderIds) ||
			(payload.removedSenderIds !== undefined &&
				!this.isSenderIdArray(payload.removedSenderIds))
		) {
			return;
		}
		const committerParticipantId = this.resolveParticipantBySenderId(
			roomId,
			payload.committerSenderId,
		);
		if (!committerParticipantId) return;
		this.emitToTarget(roomId, committerParticipantId, {
			type: 'commit-request',
			epochNumber: payload.epochNumber,
			nextEpochNumber: payload.nextEpochNumber,
			membershipDeltaId: payload.membershipDeltaId,
			membershipDeltaHash: payload.membershipDeltaHash,
			rosterHash: payload.rosterHash,
			committerSenderId: payload.committerSenderId,
			joiningSenderIds: payload.joiningSenderIds,
		});
	}

	private async relayCommit(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			!this.isEpochNumber(payload.previousEpochNumber) ||
			!this.isEpochNumber(payload.epochNumber) ||
			payload.epochNumber !== payload.previousEpochNumber + 1 ||
			!this.isDeltaId(payload.membershipDeltaId) ||
			!this.isHash(payload.membershipDeltaHash) ||
			!this.isHash(payload.rosterHash) ||
			!this.isOpaqueMlsBytes(payload.mlsCommit)
		) {
			return;
		}
		if (this.roster && !(await this.roster.get(roomId, fromSenderId))) {
			console.warn(
				'[DEBUG-e2ee] SFU: rejecting commit from non-roster senderId',
				{ roomId, fromSenderId },
			);
			return;
		}
		const commit = {
			type: 'commit' as const,
			fromParticipantId,
			fromSenderId,
			previousEpochNumber: payload.previousEpochNumber,
			epochNumber: payload.epochNumber,
			membershipDeltaId: payload.membershipDeltaId,
			membershipDeltaHash: payload.membershipDeltaHash,
			rosterHash: payload.rosterHash,
			mlsCommit: payload.mlsCommit,
		};
		this.retainCommit(roomId, commit);
		this.emitToFullAccessParticipants(roomId, commit);
	}

	private relayWelcome(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): void {
		if (
			!this.isSenderId(payload.toSenderId) ||
			!this.isEpochNumber(payload.epochNumber) ||
			!this.isOpaqueMlsBytes(payload.mlsWelcome)
		) {
			return;
		}
		const toParticipantId = this.resolveParticipantBySenderId(
			roomId,
			payload.toSenderId,
		);
		if (!toParticipantId) return;
		const welcome = {
			type: 'welcome' as const,
			fromParticipantId,
			fromSenderId,
			toParticipantId,
			toSenderId: payload.toSenderId,
			epochNumber: payload.epochNumber,
			mlsWelcome: payload.mlsWelcome,
		};
		this.retainWelcome(roomId, welcome);
		this.emitToTarget(roomId, toParticipantId, welcome);
	}

	private recordAck(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): void {
		if (!this.isEpochNumber(payload.epochNumber)) return;
		const retained = this.getRetainedEpoch(roomId, payload.epochNumber);
		let epochAcks = retained.acks.get(payload.epochNumber);
		if (!epochAcks) {
			epochAcks = new Set();
			retained.acks.set(payload.epochNumber, epochAcks);
		}
		epochAcks.add(fromSenderId);
		this.emitToFullAccessParticipants(roomId, {
			type: 'ack',
			fromParticipantId,
			fromSenderId,
			epochNumber: payload.epochNumber,
		});
	}

	private async replayRetainedMaterial(
		roomId: string,
		fromSenderId: number,
		payload: E2eeEpochPayload,
	): Promise<void> {
		if (
			payload.knownEpochNumber !== undefined &&
			!this.isEpochNumber(payload.knownEpochNumber)
		) {
			return;
		}
		const targetParticipantId = this.resolveParticipantBySenderId(
			roomId,
			fromSenderId,
		);
		if (!targetParticipantId) return;
		const retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) return;
		let sentAny = false;
		for (const [epochNumber, retained] of retainedByEpoch.entries()) {
			if (
				payload.knownEpochNumber !== undefined &&
				epochNumber <= payload.knownEpochNumber
			) {
				continue;
			}
			if (retained.commit) {
				this.emitToTarget(roomId, targetParticipantId, retained.commit);
				sentAny = true;
			}
			const welcome = retained.welcomes.get(fromSenderId);
			if (welcome) {
				this.emitToTarget(roomId, targetParticipantId, welcome);
				sentAny = true;
			}
		}
		if (!sentAny) {
			console.log(
				'[DEBUG-e2ee] SFU: resync-request had no retained material; requesting fresh key package',
				{
					roomId,
					fromSenderId,
					knownEpochNumber: payload.knownEpochNumber ?? null,
				},
			);
			const epochNumber = this.getCurrentEpochNumber(roomId);
			this.emitToTarget(roomId, targetParticipantId, {
				type: 'key-package-request',
				epochNumber,
				reason: 'reconnect',
			});
		}
	}

	private retainCommit(
		roomId: string,
		commit: Extract<E2eeEpochEnvelope, { type: 'commit' }>,
	): void {
		const currentEpoch = this.getCurrentEpochNumber(roomId);
		if (commit.epochNumber > currentEpoch) {
			this.currentEpochByRoom.set(roomId, commit.epochNumber);
		}
		this.getRetainedEpoch(roomId, commit.epochNumber).commit = commit;
		this.pruneRetainedMaterial(roomId);
	}

	private retainWelcome(
		roomId: string,
		welcome: Extract<E2eeEpochEnvelope, { type: 'welcome' }>,
	): void {
		this.getRetainedEpoch(roomId, welcome.epochNumber).welcomes.set(
			welcome.toSenderId,
			welcome,
		);
		this.pruneRetainedMaterial(roomId);
	}

	private getRetainedEpoch(
		roomId: string,
		epochNumber: number,
	): RetainedEpochMaterial {
		let retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) {
			retainedByEpoch = new Map();
			this.retainedMaterial.set(roomId, retainedByEpoch);
		}
		let retained = retainedByEpoch.get(epochNumber);
		if (!retained) {
			retained = { welcomes: new Map(), acks: new Map() };
			retainedByEpoch.set(epochNumber, retained);
		}
		return retained;
	}

	private pruneRetainedMaterial(roomId: string): void {
		const retainedByEpoch = this.retainedMaterial.get(roomId);
		if (!retainedByEpoch) return;
		const retainedEpochs = [...retainedByEpoch.keys()].sort((a, b) => b - a);
		for (const staleEpoch of retainedEpochs.slice(RETAINED_EPOCHS)) {
			retainedByEpoch.delete(staleEpoch);
		}
	}

	private isEpochNumber(value: unknown): value is number {
		return typeof value === 'number' && Number.isInteger(value) && value >= 1;
	}

	private isSenderId(value: unknown): value is number {
		return (
			typeof value === 'number' &&
			Number.isInteger(value) &&
			value >= 0 &&
			value <= SENDER_ID_MAX
		);
	}

	private isSenderIdArray(value: unknown): value is number[] {
		return (
			Array.isArray(value) &&
			value.length > 0 &&
			value.every((id) => this.isSenderId(id))
		);
	}

	private isDeltaId(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= MAX_DELTA_ID_LENGTH
		);
	}

	private isHash(value: unknown): value is string {
		return typeof value === 'string' && HASH_PATTERN.test(value);
	}

	private isOpaqueMlsBytes(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= MAX_OPAQUE_MLS_BYTES &&
			BASE64_PATTERN.test(value)
		);
	}

	private isKeyPackageReason(
		value: unknown,
	): value is 'enable' | 'join' | 'reconnect' {
		return value === 'enable' || value === 'join' || value === 'reconnect';
	}

	private findSocketByParticipantId(
		roomId: string,
		participantId: string,
	): TypedSocket | null {
		const socketsInRoom = this.io.sockets.adapter.rooms.get(roomId);
		if (!socketsInRoom) return null;

		for (const socketId of socketsInRoom) {
			const socket = this.io.sockets.sockets.get(socketId) as
				| TypedSocket
				| undefined;
			if (socket && socket.participantId === participantId) {
				return socket;
			}
		}
		return null;
	}

	private findHostSocket(roomId: string): TypedSocket | null {
		const socketsInRoom = this.io.sockets.adapter.rooms.get(roomId);
		if (!socketsInRoom) return null;

		for (const socketId of socketsInRoom) {
			const socket = this.io.sockets.sockets.get(socketId) as
				| TypedSocket
				| undefined;
			if (
				socket?.isHost &&
				socket.participantId &&
				this.fullAccessSockets.get(roomId)?.has(socket.id)
			) {
				return socket;
			}
		}
		return null;
	}

	private resolveParticipantBySenderId(
		roomId: string,
		senderId: number,
	): string | undefined {
		const map = this.participantToSender.get(roomId);
		if (!map) return undefined;
		for (const [participantId, sid] of map.entries()) {
			if (sid === senderId) return participantId;
		}
		return undefined;
	}

	private emitToTarget(
		roomId: string,
		participantId: string,
		data: E2eeEpochEnvelope,
	): void {
		const socket = this.findSocketByParticipantId(roomId, participantId);
		if (!socket) return;
		if (!this.fullAccessSockets.get(roomId)?.has(socket.id)) return;
		socket.emit('e2ee:epoch', data);
	}

	private emitToFullAccessParticipants(
		roomId: string,
		data: E2eeEpochEnvelope,
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: typed-socket emit with narrowed payload
				(socket as any).emit('e2ee:epoch', data);
			}
		}
	}
}
