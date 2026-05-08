import type { Producer } from 'mediasoup/node/lib/ProducerTypes';
import type { TranscriptSegment } from '../types';
import { loggers } from '../utils/logger';
import { AudioIngester } from './AudioIngester';
import {
	type IWhisperClient,
	MockWhisperClient,
	WhisperClient,
} from './WhisperClient';

interface SttManagerOptions {
	/** URL of the STT server (e.g. http://127.0.0.1:8080) */
	whisperServerUrl?: string;
	/** Use mock client in development when no STT server is configured */
	allowMockFallback?: boolean;
}

export class SttManager {
	private whisperClient: IWhisperClient;
	private activeSessions = new Map<string, AudioIngester>();
	private roomSubscribers = new Map<string, Set<string>>();
	private roomActiveSpeakers = new Map<string, Set<string>>();
	private emitToRoom:
		| ((roomId: string, event: string, data: unknown) => void)
		| undefined;
	private getRouter:
		| ((
				roomId: string,
		  ) => import('mediasoup/node/lib/RouterTypes').Router | undefined)
		| undefined;

	constructor(options: SttManagerOptions) {
		if (options.whisperServerUrl) {
			const url = options.whisperServerUrl.trim();
			loggers.stt.info('Using STT server: %s', url);
			this.whisperClient = new WhisperClient(url);
		} else if (options.allowMockFallback) {
			loggers.stt.warn('No STT server URL configured. Using mock client.');
			this.whisperClient = new MockWhisperClient();
		} else {
			loggers.stt.warn('STT disabled: no server URL and mock fallback is off.');
			this.whisperClient = new MockWhisperClient();
			(this.whisperClient as MockWhisperClient).isAvailable = () => false;
		}
	}

	setEmitToRoom(
		fn: (roomId: string, event: string, data: unknown) => void,
	): void {
		this.emitToRoom = fn;
	}

	setGetRouter(
		fn: (
			roomId: string,
		) => import('mediasoup/node/lib/RouterTypes').Router | undefined,
	): void {
		this.getRouter = fn;
	}

	setActiveSpeakers(roomId: string, participantIds: string[]): void {
		this.roomActiveSpeakers.set(roomId, new Set(participantIds));
	}

	isActiveSpeaker(roomId: string, participantId: string): boolean {
		const speakers = this.roomActiveSpeakers.get(roomId);
		if (!speakers) return true;
		return speakers.has(participantId);
	}

	hasSubscribers(roomId: string): boolean {
		return (this.roomSubscribers.get(roomId)?.size ?? 0) > 0;
	}

	getSubscribers(roomId: string): Set<string> | undefined {
		return this.roomSubscribers.get(roomId);
	}

	addSubscriber(roomId: string, socketId: string): boolean {
		if (!this.roomSubscribers.has(roomId)) {
			this.roomSubscribers.set(roomId, new Set());
		}
		const set = this.roomSubscribers.get(roomId)!;
		const wasFirst = set.size === 0;
		set.add(socketId);
		loggers.stt.info(
			'STT subscriber added for room %s (socket: %s, total: %d)',
			roomId,
			socketId,
			set.size,
		);
		return wasFirst;
	}

	removeSubscriber(roomId: string, socketId: string): boolean {
		const set = this.roomSubscribers.get(roomId);
		if (!set) return false;
		set.delete(socketId);
		const isEmpty = set.size === 0;
		if (isEmpty) {
			this.roomSubscribers.delete(roomId);
		}
		loggers.stt.info(
			'STT subscriber removed for room %s (socket: %s, total: %d)',
			roomId,
			socketId,
			set.size,
		);
		return isEmpty;
	}

	async startTranscription(
		roomId: string,
		participantId: string,
		participantName: string | undefined,
		producer: Producer,
	): Promise<void> {
		if (!this.hasSubscribers(roomId)) {
			loggers.stt.debug('STT has no subscribers for room %s, skipping', roomId);
			return;
		}

		const sessionKey = `${roomId}:${participantId}`;
		if (this.activeSessions.has(sessionKey)) {
			loggers.stt.debug('Transcription already active for %s', sessionKey);
			return;
		}

		if (!this.whisperClient.isAvailable()) {
			loggers.stt.warn('STT server unavailable, cannot start transcription');
			return;
		}

		const router = this.getRouter?.(roomId);
		if (!router) {
			loggers.stt.error('Router not found for room %s', roomId);
			return;
		}

		const ingester = new AudioIngester({
			roomId,
			participantId,
			participantName,
			producer,
			router,
			whisperClient: this.whisperClient,
			isActiveSpeaker: () => this.isActiveSpeaker(roomId, participantId),
			onTranscript: (text, isFinal, durationMs) => {
				this.handleTranscript(
					roomId,
					participantId,
					participantName,
					text,
					isFinal,
					durationMs,
				);
			},
		});

		this.activeSessions.set(sessionKey, ingester);
		try {
			await ingester.start();
		} catch (error) {
			this.activeSessions.delete(sessionKey);
			throw error;
		}
	}

	async stopTranscription(
		roomId: string,
		participantId: string,
	): Promise<void> {
		const sessionKey = `${roomId}:${participantId}`;
		const ingester = this.activeSessions.get(sessionKey);
		if (!ingester) return;

		await ingester.stop();
		this.activeSessions.delete(sessionKey);
	}

	async stopRoom(roomId: string): Promise<void> {
		const stops: Promise<void>[] = [];
		for (const [key, ingester] of this.activeSessions) {
			if (key.startsWith(`${roomId}:`)) {
				this.activeSessions.delete(key);
				stops.push(
					ingester.stop().catch((error) => {
						loggers.stt.error(
							'Error stopping ingester: %s',
							(error as Error).message,
						);
					}),
				);
			}
		}
		await Promise.all(stops);
		this.roomSubscribers.delete(roomId);
		this.roomActiveSpeakers.delete(roomId);
	}

	destroy(): void {
		if (typeof (this.whisperClient as WhisperClient).destroy === 'function') {
			(this.whisperClient as WhisperClient).destroy();
		}
	}

	private handleTranscript(
		roomId: string,
		participantId: string,
		participantName: string | undefined,
		text: string,
		isFinal: boolean,
		durationMs: number,
	): void {
		const now = Date.now();
		const segment: TranscriptSegment = {
			participantId,
			participantName,
			text,
			isFinal,
			timestamp: new Date(now).toISOString(),
			segmentStart: now - durationMs,
			segmentEnd: now,
		};

		if (this.emitToRoom) {
			this.emitToRoom(roomId, 'stt:segment', { roomId, segment });
		}
	}
}
