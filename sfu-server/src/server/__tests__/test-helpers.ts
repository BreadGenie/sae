import type { Server, Socket } from 'socket.io';
import { vi } from 'vitest';
import type { MediasoupManager } from '../../mediasoup/MediasoupManager';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SFUScope,
	SocketData,
} from '../../types';
import type { AuthManager } from '../AuthManager';
import { SocketHandlerManager } from '../SocketHandlerManager';

export type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

export type SocketEventName = string;

export interface MockSocket extends TypedSocket {
	fire(event: SocketEventName, ...args: unknown[]): void;
	emitCalls: { event: string; data: unknown }[];
	toEmits: { roomId: string; event: string; data: unknown }[];
	joinCalls: string[];
	leaveCalls: string[];
	disconnectCalls: boolean[];
}

const SOCKET_DEFAULTS = {
	id: 'sock-1',
	userId: 'user-1',
	userName: 'Alice',
	meetingId: 'room-1',
	site: undefined as string | undefined,
	isHost: false,
	isCohost: false,
	scope: 'full' as SFUScope,
};

export function createMockSocket(
	partial: Partial<TypedSocket> = {},
): MockSocket {
	const handlers = new Map<SocketEventName, ((...args: unknown[]) => void)[]>();
	const emitCalls: { event: string; data: unknown }[] = [];
	const toEmits: { roomId: string; event: string; data: unknown }[] = [];
	const joinCalls: string[] = [];
	const leaveCalls: string[] = [];
	const disconnectCalls: boolean[] = [];
	const useFns: Array<(p: unknown, n: (err?: Error) => void) => void> = [];

	const socket = {
		id: SOCKET_DEFAULTS.id,
		userId: SOCKET_DEFAULTS.userId,
		userName: SOCKET_DEFAULTS.userName,
		meetingId: SOCKET_DEFAULTS.meetingId,
		site: SOCKET_DEFAULTS.site,
		isHost: SOCKET_DEFAULTS.isHost,
		isCohost: SOCKET_DEFAULTS.isCohost,
		scope: SOCKET_DEFAULTS.scope,
		handshake: {
			address: '127.0.0.1',
			headers: {} as Record<string, string | string[] | undefined>,
			auth: {},
			query: {},
		},
		connected: true,
		disconnected: false,
		...partial,
		on(event: SocketEventName, handler: (...args: unknown[]) => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return this;
		},
		off(event: SocketEventName) {
			handlers.delete(event);
			return this;
		},
		emit(event: string, data?: unknown) {
			emitCalls.push({ event, data });
			return true;
		},
		to(roomId: string) {
			const ctx = {
				emit(event: string, data?: unknown) {
					toEmits.push({ roomId, event, data });
					return true;
				},
			};
			return ctx;
		},
		join(roomId: string) {
			joinCalls.push(roomId);
			return Promise.resolve(this);
		},
		leave(roomId: string) {
			leaveCalls.push(roomId);
			return Promise.resolve(this);
		},
		disconnect(close: boolean) {
			disconnectCalls.push(close);
			(socket as { disconnected: boolean }).disconnected = true;
			return socket;
		},
		use(fn: (p: unknown, n: (err?: Error) => void) => void) {
			useFns.push(fn);
			return this;
		},
		fire(event: SocketEventName, ...args: unknown[]) {
			const list = handlers.get(event) ?? [];
			for (const h of list) h(...args);
		},
		emitCalls,
		toEmits,
		joinCalls,
		leaveCalls,
		disconnectCalls,
	} as unknown as MockSocket;

	return socket;
}

interface MockServer {
	io: Server<ClientToServerEvents, ServerToClientEvents>;
	useFns: Array<(s: Socket, n: (err?: Error) => void) => void>;
	connectionFn: ((s: Socket) => void) | null;
	socketsAdapterRooms: Map<string, Set<string>>;
	socketsMap: Map<string, Socket>;
}

function createMockServer(): MockServer {
	const useFns: Array<(s: Socket, n: (err?: Error) => void) => void> = [];
	const socketsAdapterRooms = new Map<string, Set<string>>();
	const socketsMap = new Map<string, Socket>();

	const mock: MockServer = {
		io: undefined as unknown as Server<
			ClientToServerEvents,
			ServerToClientEvents
		>,
		useFns,
		connectionFn: null,
		socketsAdapterRooms,
		socketsMap,
	};

	const io = {
		use(fn: (s: Socket, n: (err?: Error) => void) => void) {
			useFns.push(fn);
			return io;
		},
		on(event: string, fn: (s: Socket) => void) {
			if (event === 'connection') mock.connectionFn = fn;
			return io;
		},
		sockets: {
			adapter: {
				rooms: socketsAdapterRooms,
			},
			sockets: socketsMap,
		},
	} as unknown as Server<ClientToServerEvents, ServerToClientEvents>;

	mock.io = io;
	return mock;
}

function createMockMediasoupManager(): MediasoupManager {
	const fns = {
		onNetworkQualityUpdate: vi.fn().mockReturnValue(() => {}),
		createRoom: vi.fn().mockResolvedValue({
			peers: new Map(),
			activeSpeakerObserver: null,
		}),
		closeRoom: vi.fn().mockResolvedValue(undefined),
		addPeer: vi.fn(),
		removePeer: vi.fn().mockResolvedValue(undefined),
		getRouterRtpCapabilities: vi.fn().mockReturnValue({}),
		getExistingProducers: vi.fn().mockResolvedValue([]),
		getRoomParticipants: vi.fn().mockReturnValue([]),
		applyMediaControl: vi.fn(),
		peerExistsInRoom: vi.fn().mockReturnValue(true),
		createWebRtcTransport: vi.fn().mockResolvedValue({}),
		connectWebRtcTransport: vi.fn().mockResolvedValue(undefined),
		restartWebRtcTransportIce: vi.fn().mockResolvedValue({}),
		createPlainTransport: vi.fn().mockResolvedValue({}),
		createProducer: vi.fn().mockResolvedValue({
			id: 'producer-1',
			kind: 'audio',
			appData: {},
		}),
		createConsumer: vi.fn().mockResolvedValue({}),
		closeProducer: vi
			.fn()
			.mockReturnValue({ isScreen: false, removedConsumers: [] }),
		closeConsumer: vi.fn().mockResolvedValue(undefined),
		updateConsumerPreferences: vi.fn().mockResolvedValue({}),
		pauseProducer: vi.fn().mockResolvedValue(true),
		resumeProducer: vi.fn().mockResolvedValue(true),
		notifyPeerRemoved: vi.fn(),
		setPeerMediaState: vi.fn(),
		getRoomStats: vi.fn().mockReturnValue({ rooms: 0, peers: 0 }),
		getRouterStats: vi.fn().mockReturnValue({}),
		close: vi.fn(),
		cleanup: vi.fn(),
	};
	return fns as unknown as MediasoupManager;
}

function createMockAuthManager(): AuthManager {
	return {
		authenticateSocket: vi.fn().mockReturnValue(true),
		ensureFullAccess: vi.fn(),
		ensurePresenceAccess: vi.fn(),
		updateSocketToken: vi.fn(),
		isTokenExpired: vi.fn().mockReturnValue(false),
		triggerTokenExpiry: vi.fn(),
		cleanupSocket: vi.fn(),
		getUserAvatar: vi.fn(),
		destroy: vi.fn(),
	} as unknown as AuthManager;
}

interface ManagerHarness {
	manager: SocketHandlerManager;
	io: MockServer;
	mediasoup: ReturnType<typeof createMockMediasoupManager>;
	authManager: ReturnType<typeof createMockAuthManager>;
	connect(socket: MockSocket): void;
}

export function createManager(): ManagerHarness {
	const io = createMockServer();
	const mediasoup = createMockMediasoupManager();
	const authManager = createMockAuthManager();
	const manager = new SocketHandlerManager(
		io.io,
		mediasoup as unknown as MediasoupManager,
		authManager as unknown as AuthManager,
	);
	manager.setupSocketHandlers();

	const connect = (socket: MockSocket) => {
		if (!io.connectionFn) throw new Error('No connection handler registered');
		io.socketsMap.set(socket.id, socket);
		io.connectionFn(socket);
	};

	return { manager, io, mediasoup, authManager, connect };
}
