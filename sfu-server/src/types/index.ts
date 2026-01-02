import type { AudioLevelObserver } from 'mediasoup/node/lib/AudioLevelObserverTypes';
import type { Consumer } from 'mediasoup/node/lib/ConsumerTypes';
import type { Producer } from 'mediasoup/node/lib/ProducerTypes';
import type { Router } from 'mediasoup/node/lib/RouterTypes';
import type {
	DtlsParameters,
	IceCandidate,
	IceParameters,
	WebRtcTransport,
} from 'mediasoup/node/lib/WebRtcTransportTypes';
import type {
	WorkerLogLevel,
	WorkerLogTag,
	WorkerSettings,
} from 'mediasoup/node/lib/WorkerTypes';
import type { RtpCodecCapability } from 'mediasoup/node/lib/rtpParametersTypes';
import type { RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/types';
import type { AppData } from 'mediasoup/node/lib/types';

// Re-export mediasoup types
export type { RtpCapabilities, RtpParameters };
export type {
	WebRtcTransport,
	Producer,
	Consumer,
	Router,
	AudioLevelObserver,
	RtpCodecCapability,
	IceParameters,
	IceCandidate,
	DtlsParameters,
	WorkerLogLevel,
	WorkerSettings,
	WorkerLogTag,
	AppData,
};

// Socket.IO types
export interface ServerToClientEvents {
	participant_joined: (data: {
		roomId: string;
		participantId: string;
		userData: UserData;
	}) => void;
	participant_left: (data: { roomId: string; participantId: string }) => void;
	producer_created: (data: {
		roomId: string;
		producerId: string;
		participantId: string;
		kind: 'audio' | 'video';
		paused: boolean;
		isScreen: boolean;
	}) => void;
	producer_closed: (data: {
		roomId: string;
		producerId: string;
		participantId: string;
		isScreen: boolean;
	}) => void;
	consumer_closed: (data: { consumerId: string; peerId?: string }) => void;
	media_control_update: (data: {
		participantId: string;
		action: MediaControlAction;
		timestamp: string;
	}) => void;
	host_control_update: (data: {
		action: HostControlAction;
		targetParticipantId: string;
		hostId: string;
		timestamp: string;
	}) => void;
	screen_share_started: (data: {
		participantId: string;
		shareData: ScreenShareData;
		timestamp: string;
	}) => void;
	screen_share_stopped: (data: {
		participantId: string;
		timestamp: string;
	}) => void;
	'chat:message': (data: ChatMessage) => void;
	'reaction:message': (data: ReactionMessage) => void;
	webrtc_offer: (data: WebRTCSignalData) => void;
	webrtc_answer: (data: WebRTCSignalData) => void;
	ice_candidate: (data: WebRTCSignalData) => void;
	active_speaker: (data: { participantIds: string[] }) => void;
	sfu_error: (data: { error: string; timestamp: string }) => void;
	'auth:expired': (data: { timestamp: string; reason: string }) => void;
	hand_raised: (data: {
		participantId: string;
		raised: boolean;
		timestamp: string;
	}) => void;
	existing_raised_hands: (data: { hands: Record<string, boolean> }) => void;
}

export interface ClientToServerEvents {
	'auth:update_token': (
		data: { token: string },
		callback: (response: SFUResponse) => void,
	) => void;
	join_room: (
		data: {
			roomId: string;
			userData: UserData;
			mediaState: { audio_enabled: boolean; video_enabled: boolean };
		},
		callback: (response: SFUResponse) => void,
	) => void;
	get_router_rtp_capabilities: (
		data: Record<string, never>,
		callback: (response: RouterRtpCapabilitiesResponse) => void,
	) => void;
	create_webrtc_transport: (
		data: { direction: 'send' | 'recv' },
		callback: (response: WebRTCTransportResponse) => void,
	) => void;
	connect_webrtc_transport: (
		data: { transportId: string; dtlsParameters: DtlsParameters },
		callback: (response: SFUResponse) => void,
	) => void;
	create_producer: (
		data: {
			transportId: string;
			rtpParameters: RtpParameters;
			kind: 'audio' | 'video';
			appData?: Record<string, unknown>;
		},
		callback: (response: ProducerResponse) => void,
	) => void;
	create_consumer: (
		data: {
			transportId: string;
			producerId: string;
			rtpCapabilities: RtpCapabilities;
		},
		callback: (response: ConsumerResponse) => void,
	) => void;
	close_producer: (
		data: { producerId: string },
		callback: (response: CloseProducerResponse) => void,
	) => void;
	close_consumer: (
		data: { consumerId: string },
		callback: (response: SFUResponse) => void,
	) => void;
	get_existing_producers: (
		data: Record<string, never>,
		callback: (response: ExistingProducersResponse) => void,
	) => void;
	get_room_participants: (
		data: Record<string, never>,
		callback: (response: RoomParticipantsResponse) => void,
	) => void;
	webrtc_offer: (data: WebRTCSignalData) => void;
	webrtc_answer: (data: WebRTCSignalData) => void;
	ice_candidate: (data: WebRTCSignalData) => void;
	media_control: (data: { action: MediaControlAction }) => void;
	host_control: (data: {
		action: HostControlAction;
		targetParticipantId: string;
	}) => void;
	screen_share: (data: {
		action: 'start_share' | 'stop_share';
		shareData?: ScreenShareData;
	}) => void;
	'chat:send': (data: { message: string; clientId?: string }) => void;
	'reaction:send': (data: { reaction: string; clientId?: string }) => void;
	'consumer:update_preferences': (
		data: {
			consumerId: string;
			visible: boolean;
			width?: number;
			height?: number;
		},
		callback: (response: ConsumerPreferenceResponse) => void,
	) => void;
	raise_hand: (
		data: { raised: boolean },
		callback: (response: SFUResponse) => void,
	) => void;
	leave_room: (data?: { roomId?: string }) => void;
}

export interface InterServerEvents {
	ping: () => void;
}

export interface SocketData {
	userId: string;
	userName: string;
	meetingId: string;
	isHost: boolean;
	isGuest?: boolean;
	roomId?: string;
	participantId?: string;
	scope?: 'presence-preview' | 'full';
}

// Core data types
export interface UserData {
	name: string;
	userId: string;
	avatar?: string;
	audio_enabled: boolean;
	video_enabled: boolean;
	is_guest?: boolean;
}

export interface SFUResponse {
	success: boolean;
	error?: string;
}

export interface RouterRtpCapabilitiesResponse extends SFUResponse {
	rtpCapabilities: RtpCapabilities;
}

export interface WebRTCTransportResponse extends SFUResponse {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
}

export interface ProducerResponse extends SFUResponse, ProducerInfo {
	isScreen: boolean;
}

export interface ConsumerResponse extends SFUResponse, ConsumerInfo {}

export interface CloseProducerResponse
	extends SFUResponse,
		CloseProducerResult {}

export interface ConsumerPreferenceResponse extends SFUResponse {
	appliedLayers?: {
		spatialLayer: number | null;
		temporalLayer: number | null;
	};
	paused?: boolean;
	visible?: boolean;
}

export interface ExistingProducersResponse extends SFUResponse {
	producers: ExistingProducer[];
}

export interface RoomParticipantsResponse extends SFUResponse {
	participants: ParticipantInfo[] | PreviewParticipantInfo[];
}

export interface WebRTCTransportParams {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
}

export interface ProducerInfo {
	id: string;
	kind: 'audio' | 'video';
	appData: Record<string, unknown>;
}
export interface ConsumerInfo {
	id: string;
	producerId: string;
	kind: 'audio' | 'video';
	rtpParameters: RtpParameters;
	paused: boolean;
}

export interface CloseProducerResult {
	isScreen: boolean;
	removedConsumers: Array<{
		consumerId: string;
		peerId: string;
		roomId: string;
	}>;
}

export interface ExistingProducer {
	id: string;
	roomId: string;
	user_id: string;
	kind: 'audio' | 'video';
	paused: boolean;
	isScreen: boolean;
}

export interface ParticipantInfo {
	id: string;
	user_id: string;
	info: {
		name?: string;
		userId: string;
		avatar?: string;
		audio_enabled: boolean;
		video_enabled: boolean;
		is_guest?: boolean;
	};
}

export interface PreviewParticipantInfo {
	id: string;
	info: {
		name?: string;
		avatar?: string;
	};
}

export type MediaControlAction = 'mute' | 'unmute' | 'video_off' | 'video_on';

export type HostControlAction =
	| 'mute_participant'
	| 'kick_participant'
	| 'lower_hand';

// Screen share data interface
export interface ScreenShareData {
	streamId?: string;
	kind?: 'video';
	isScreen?: boolean;
	[key: string]: unknown;
}

// WebRTC signaling data interface
export interface WebRTCSignalData {
	fromUser?: string;
	targetUser: string;
	signalData: Record<string, unknown>;
}

export interface ChatMessage {
	roomId: string;
	message: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
	clientId?: string;
}

export interface ReactionMessage {
	roomId: string;
	reaction: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
}

// Mediasoup Manager types
export interface Room {
	id: string;
	router: Router;
	audioLevelObserver: AudioLevelObserver;
	peers: Map<string, Peer>;
	created: Date;
}

export interface Peer {
	id: string;
	info: PeerInfo;
	transports: Map<string, WebRtcTransport>;
	producers: Map<string, Producer>;
	consumers: Map<string, Consumer>;
	joined: Date;
}

export interface PeerInfo extends UserData {}

export interface TransportData {
	roomId: string;
	peerId: string;
	transport: WebRtcTransport;
}

export interface ProducerData {
	roomId: string;
	peerId: string;
	producer: Producer;
}

export interface ConsumerData {
	roomId: string;
	peerId: string;
	consumer: Consumer;
}

export interface RoomStats {
	id: string;
	created: Date;
	peerCount: number;
	peers: string[];
}

// Configuration types
export interface MediasoupConfig {
	numWorkers: number;
	worker: WorkerSettings;
	router: RouterConfig;
	webRtcTransport: WebRTCTransportOptions;
}

export interface RouterConfig {
	mediaCodecs: RtpCodecCapability[];
}

export interface WebRTCTransportOptions {
	listenIps: Array<{ ip: string; announcedIp: string }>;
	enableUdp: boolean;
	enableTcp: boolean;
	preferUdp: boolean;
	portRange: { min: number; max: number };
	maxIncomingBitrate: number;
	maxOutgoingBitrate: number;
	initialAvailableOutgoingBitrate: number;
	iceServers: Array<{ urls: string[] }>;
	iceTransportPolicy: string;
}

// JWT types
export interface JWTPayload {
	user_id: string;
	user_name: string;
	meeting_id: string;
	user_avatar?: string;
	is_host: boolean;
	scope?: 'presence-preview' | 'full';
	session_id?: string;
	exp?: number;
	iat?: number;
}

// Server types
export interface ServerConfig {
	port: number;
	host: string;
	jwtSecret: string;
}

export interface HealthStats {
	status: 'healthy';
	uptime: number;
	memory: NodeJS.MemoryUsage;
	rooms: number;
	peers: number;
}

// Socket.IO module augmentation
declare module 'socket.io' {
	interface Socket {
		userId: string;
		userName: string;
		meetingId: string;
		isHost: boolean;
		roomId?: string;
		participantId?: string;
		currentToken?: string;
		tokenExpiresAt?: number;
		tokenExpiryTimer?: NodeJS.Timeout;
		scope?: 'presence-preview' | 'full';
	}
}
