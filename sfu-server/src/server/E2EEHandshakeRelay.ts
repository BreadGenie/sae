import type { Server, Socket } from 'socket.io';
import type {
	ClientToServerEvents,
	E2eeHandshakeEnvelope,
	ServerToClientEvents,
	SocketData,
} from '../types';
import { loggers } from '../utils/logger';

type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

type E2eeHandshakePayload = {
	fromParticipantId?: string;
	fromSenderId?: number;
	toParticipantId?: string;
	toSenderId?: number;
	x25519PublicKey?: string;
	signingPublicKey?: string;
	envelope?: string;
	hostX25519PublicKey?: string;
	hostSigningPublicKey?: string;
};

const BASE64_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const BASE64_ENVELOPE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ENVELOPE_MAX_LENGTH = 512;
const SENDER_ID_MAX = 0xffffffff;

export class E2EEHandshakeRelay {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private fullAccessSockets: Map<string, Set<string>>;
	private participantToSender: Map<string, Map<string, number>>;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		fullAccessSockets: Map<string, Set<string>>,
		participantToSender: Map<string, Map<string, number>>,
	) {
		this.io = io;
		this.fullAccessSockets = fullAccessSockets;
		this.participantToSender = participantToSender;
	}

	setup(socket: Socket): void {
		socket.on('e2ee:handshake', (payload: E2eeHandshakePayload) => {
			this.handle(socket, payload);
		});
	}

	private handle(socket: Socket, payload: E2eeHandshakePayload): void {
		try {
			if (socket.scope !== 'full') {
				return;
			}
			const roomId = socket.roomId;
			const fromParticipantId = socket.participantId;
			const fromSenderId = socket.senderId;
			if (!roomId || !fromParticipantId || fromSenderId === undefined) {
				return;
			}

			if (this.isJoinerHello(payload)) {
				this.relayJoinerHello(roomId, fromParticipantId, fromSenderId, payload);
				return;
			}

			if (this.isEnvelopeReply(payload)) {
				this.relayEnvelopeReply(
					roomId,
					fromParticipantId,
					fromSenderId,
					payload,
				);
				return;
			}
		} catch (error) {
			loggers.socketHandler.warn(
				'e2ee:handshake relay failed: %s',
				(error as Error).message,
			);
		}
	}

	private isJoinerHello(payload: E2eeHandshakePayload): boolean {
		return (
			payload.x25519PublicKey !== undefined ||
			payload.signingPublicKey !== undefined
		);
	}

	private isEnvelopeReply(payload: E2eeHandshakePayload): boolean {
		return payload.envelope !== undefined || payload.toSenderId !== undefined;
	}

	private isBase64PublicKey(value: unknown): value is string {
		return typeof value === 'string' && BASE64_PUBLIC_KEY_PATTERN.test(value);
	}

	private isBoundedEnvelope(value: unknown): value is string {
		return (
			typeof value === 'string' &&
			value.length > 0 &&
			value.length <= ENVELOPE_MAX_LENGTH &&
			BASE64_ENVELOPE_PATTERN.test(value)
		);
	}

	private isSenderId(value: unknown): value is number {
		return (
			typeof value === 'number' &&
			Number.isInteger(value) &&
			value >= 0 &&
			value <= SENDER_ID_MAX
		);
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
		data: E2eeHandshakeEnvelope,
	): void {
		const socket = this.findSocketByParticipantId(roomId, participantId);
		if (!socket) return;
		if (!this.fullAccessSockets.get(roomId)?.has(socket.id)) return;
		socket.emit('e2ee:handshake', data);
	}

	private emitToFullAccessParticipants(
		roomId: string,
		data: E2eeHandshakeEnvelope,
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;
		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: typed-socket emit with narrowed payload
				(socket as any).emit('e2ee:handshake', data);
			}
		}
	}

	private relayJoinerHello(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeHandshakePayload,
	): void {
		const x25519PublicKey = payload.x25519PublicKey;
		const signingPublicKey = payload.signingPublicKey;
		if (
			!this.isBase64PublicKey(x25519PublicKey) ||
			!this.isBase64PublicKey(signingPublicKey) ||
			payload.envelope ||
			payload.hostX25519PublicKey ||
			payload.hostSigningPublicKey ||
			payload.toSenderId !== undefined
		) {
			return;
		}
		this.emitToFullAccessParticipants(roomId, {
			fromParticipantId,
			fromSenderId,
			x25519PublicKey,
			signingPublicKey,
		});
	}

	private relayEnvelopeReply(
		roomId: string,
		fromParticipantId: string,
		fromSenderId: number,
		payload: E2eeHandshakePayload,
	): void {
		const envelope = payload.envelope;
		const toSenderId = payload.toSenderId;
		const hostX25519PublicKey = payload.hostX25519PublicKey;
		const hostSigningPublicKey = payload.hostSigningPublicKey;
		if (
			!this.isBoundedEnvelope(envelope) ||
			!this.isSenderId(toSenderId) ||
			!this.isBase64PublicKey(hostX25519PublicKey) ||
			!this.isBase64PublicKey(hostSigningPublicKey) ||
			payload.x25519PublicKey ||
			payload.signingPublicKey
		) {
			return;
		}
		const targetParticipant = this.resolveParticipantBySenderId(
			roomId,
			toSenderId,
		);
		if (!targetParticipant) return;
		this.emitToTarget(roomId, targetParticipant, {
			fromParticipantId,
			fromSenderId,
			toParticipantId: targetParticipant,
			toSenderId,
			envelope,
			hostX25519PublicKey,
			hostSigningPublicKey,
		});
	}
}
