import { type ChildProcess, spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Consumer } from 'mediasoup/node/lib/ConsumerTypes';
import type { PlainTransport } from 'mediasoup/node/lib/PlainTransportTypes';
import type { Producer } from 'mediasoup/node/lib/ProducerTypes';
import type { Router } from 'mediasoup/node/lib/RouterTypes';
import type { RtpCapabilities } from 'mediasoup/node/lib/types';
import { loggers } from '../utils/logger';
import type { IWhisperClient } from './WhisperClient';

interface AudioIngesterOptions {
	roomId: string;
	participantId: string;
	participantName?: string;
	producer: Producer;
	router: Router;
	whisperClient: IWhisperClient;
	/** Called before each flush; if false, audio is discarded (active-speaker-only mode) */
	isActiveSpeaker?: () => boolean;
	onTranscript: (text: string, isFinal: boolean, durationMs: number) => void;
}

// ── VAD / Streaming Config ───────────────────────────────────────────────────
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // s16le

/** How often we check audio energy (ms) */
const VAD_CHECK_MS = 100;
/** Bytes of audio per VAD check */
const BYTES_PER_CHECK = (SAMPLE_RATE * BYTES_PER_SAMPLE * VAD_CHECK_MS) / 1000;

/** Consecutive silent checks before we flush (300 ms pause) */
const SILENCE_CHECKS_TO_FLUSH = 3;
/** Minimum speech checks before we consider it worth flushing (1.5 s). */
const MIN_SPEECH_CHECKS = 15;
/** Min checks for tail-end catch-up flush (500 ms) */
const MIN_TAIL_CHECKS = 5;
/** How often to send a draft update during continuous speech (2 s) */
const DRAFT_INTERVAL_CHECKS = 20;

/**
 * Normalized RMS threshold for speech vs silence.
 * 0.0 = absolute silence, 1.0 = full-scale square wave.
 * 0.012 works well for typical mic input routed through Mediasoup.
 */
const SPEECH_RMS_THRESHOLD = Number.parseFloat(
	process.env.STT_VAD_THRESHOLD || '0.012',
);

/** Max time one transcription can block the pipeline (ms) */
const TRANSCRIBE_TIMEOUT_MS = Number.parseInt(
	process.env.STT_TRANSCRIBE_TIMEOUT || '5000',
	10,
);

/**
 * Captures audio from a Mediasoup Producer via PlainTransport,
 * decodes Opus→PCM via ffmpeg, buffers audio, and flushes to
 * Whisper when the speaker pauses (VAD) or after a max duration.
 */
export class AudioIngester {
	private roomId: string;
	private participantId: string;
	private participantName?: string;
	private producer: Producer;
	private router: Router;
	private whisperClient: IWhisperClient;
	private isActiveSpeaker?: () => boolean;
	private onTranscript: (
		text: string,
		isFinal: boolean,
		durationMs: number,
	) => void;

	private plainTransport: PlainTransport | null = null;
	private consumer: Consumer | null = null;
	private ffmpeg: ChildProcess | null = null;
	private ffmpegPort = 0;
	private sdpPath = '';
	private running = false;

	// ── VAD state ──────────────────────────────────────────────────────────────
	private pcmChunks: Buffer[] = [];
	private pcmChunkBytes = 0;
	private vadQueue: Buffer[] = [];
	private vadQueueBytes = 0;
	private speechCheckCount = 0;
	private silenceCheckCount = 0;
	private isInSpeech = false;
	private vadTimer: NodeJS.Timeout | null = null;
	private chunkSumSq = 0;
	private lastDraftCheck = 0;

	constructor(options: AudioIngesterOptions) {
		this.roomId = options.roomId;
		this.participantId = options.participantId;
		this.participantName = options.participantName;
		this.producer = options.producer;
		this.router = options.router;
		this.whisperClient = options.whisperClient;
		this.isActiveSpeaker = options.isActiveSpeaker;
		this.onTranscript = options.onTranscript;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		try {
			await this.setupPlainTransport();
			await this.createConsumer();
			await this.startFfmpeg();
			this.plainTransport!.connect({
				ip: '127.0.0.1',
				port: this.ffmpegPort,
			});
			this.startVadLoop();

			loggers.stt.info(
				'AudioIngester started for %s in room %s (ffmpeg port %d, vadThreshold=%.4f)',
				this.participantId,
				this.roomId,
				this.ffmpegPort,
				SPEECH_RMS_THRESHOLD,
			);
		} catch (error) {
			this.running = false;
			loggers.stt.error(
				'Failed to start AudioIngester for %s: %s',
				this.participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.vadTimer) {
			clearTimeout(this.vadTimer);
			this.vadTimer = null;
		}

		// Flush any remaining speech
		if (this.pcmChunkBytes > 0 && this.speechCheckCount >= MIN_TAIL_CHECKS) {
			await this.flushBuffer(true);
		}

		if (this.consumer) {
			try {
				this.consumer.close();
			} catch {
				/* ignore */
			}
			this.consumer = null;
		}
		if (this.plainTransport) {
			try {
				this.plainTransport.close();
			} catch {
				/* ignore */
			}
			this.plainTransport = null;
		}
		if (this.ffmpeg && !this.ffmpeg.killed) {
			this.ffmpeg.kill('SIGTERM');
			setTimeout(() => {
				if (this.ffmpeg && !this.ffmpeg.killed) {
					this.ffmpeg.kill('SIGKILL');
				}
			}, 1000);
			this.ffmpeg = null;
		}
		if (this.sdpPath) {
			try {
				fs.unlinkSync(this.sdpPath);
			} catch {
				/* ignore */
			}
			this.sdpPath = '';
		}

		loggers.stt.info('AudioIngester stopped for %s', this.participantId);
	}

	// ── Mediasoup plumbing ─────────────────────────────────────────────────────

	private async setupPlainTransport(): Promise<void> {
		this.plainTransport = await this.router.createPlainTransport({
			listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
			rtcpMux: true,
			comedia: false,
		});
	}

	private async createConsumer(): Promise<void> {
		const rtpCapabilities: RtpCapabilities = {
			codecs: [
				{
					mimeType: 'audio/opus',
					kind: 'audio',
					preferredPayloadType: 111,
					clockRate: 48000,
					channels: 2,
					parameters: {},
					rtcpFeedback: [],
				},
			],
			headerExtensions: [],
		};

		this.consumer = await this.plainTransport!.consume({
			producerId: this.producer.id,
			rtpCapabilities,
		});
	}

	private async startFfmpeg(): Promise<void> {
		this.ffmpegPort = await this.findAvailablePort();
		const payloadType =
			this.consumer?.rtpParameters?.codecs?.[0]?.payloadType ?? 111;

		this.sdpPath = path.join(
			os.tmpdir(),
			`stt_${this.roomId}_${this.participantId}_${Date.now()}.sdp`,
		);
		fs.writeFileSync(this.sdpPath, this.buildSdp(this.ffmpegPort, payloadType));

		const args = [
			'-protocol_whitelist',
			'file,crypto,udp,rtp',
			'-i',
			this.sdpPath,
			'-f',
			's16le',
			'-ar',
			String(SAMPLE_RATE),
			'-ac',
			'1',
			'pipe:1',
		];

		this.ffmpeg = spawn('ffmpeg', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.ffmpeg.stdout!.on('data', (data: Buffer) => {
			this.vadQueue.push(data);
			this.vadQueueBytes += data.length;
		});

		this.ffmpeg.stderr!.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg && process.env.SFU_LOG_LEVEL === 'debug') {
				loggers.stt.debug('ffmpeg: %s', msg.slice(0, 200));
			}
		});

		this.ffmpeg.on('error', (error) => {
			loggers.stt.error(
				'ffmpeg error for %s: %s',
				this.participantId,
				error.message,
			);
		});

		this.ffmpeg.on('exit', (code) => {
			if (code !== 0 && this.running) {
				loggers.stt.warn(
					'ffmpeg exited with code %d for %s',
					code,
					this.participantId,
				);
			}
		});
	}

	// ── VAD loop ───────────────────────────────────────────────────────────────

	private startVadLoop(): void {
		const run = () => {
			if (!this.running) return;
			this.runVadCheck()
				.then(() => {
					if (this.running) {
						this.vadTimer = setTimeout(run, VAD_CHECK_MS);
					}
				})
				.catch((error) => {
					loggers.stt.error('VAD check error: %s', (error as Error).message);
					if (this.running) {
						this.vadTimer = setTimeout(run, VAD_CHECK_MS);
					}
				});
		};
		run();
	}

	private async runVadCheck(): Promise<void> {
		if (this.vadQueueBytes < BYTES_PER_CHECK) return;

		const frame = this.dequeueBytes(BYTES_PER_CHECK);
		const frameSumSq = this.calculateSumSq(frame);
		const rms =
			Math.sqrt(frameSumSq / (BYTES_PER_CHECK / BYTES_PER_SAMPLE)) / 32768;
		const isSpeech = rms > SPEECH_RMS_THRESHOLD;

		if (isSpeech) {
			this.silenceCheckCount = 0;
			this.speechCheckCount++;
			this.isInSpeech = true;
			this.pcmChunks.push(frame);
			this.pcmChunkBytes += frame.length;
			this.chunkSumSq += frameSumSq;
		} else {
			this.silenceCheckCount++;
			if (this.isInSpeech) {
				this.pcmChunks.push(frame);
				this.pcmChunkBytes += frame.length;
			}
		}

		if (this.shouldFlush()) {
			this.flushBuffer(true).catch(() => {});
		} else if (this.shouldDraft()) {
			this.flushDraft().catch(() => {});
		}
	}

	private shouldFlush(): boolean {
		// Flush on silence after enough speech
		if (
			this.isInSpeech &&
			this.silenceCheckCount >= SILENCE_CHECKS_TO_FLUSH &&
			this.speechCheckCount >= MIN_SPEECH_CHECKS
		) {
			return true;
		}
		// Extended silence: flush whatever audio we have, even short utterances.
		// Catches trailing words that didn't reach MIN_SPEECH_CHECKS.
		if (
			this.isInSpeech &&
			this.silenceCheckCount >= SILENCE_CHECKS_TO_FLUSH * 4 &&
			this.speechCheckCount >= MIN_TAIL_CHECKS
		) {
			return true;
		}
		return false;
	}

	private shouldDraft(): boolean {
		return (
			this.isInSpeech &&
			this.speechCheckCount >= MIN_SPEECH_CHECKS &&
			this.speechCheckCount - this.lastDraftCheck >= DRAFT_INTERVAL_CHECKS
		);
	}

	private async flushBuffer(isFinal: boolean): Promise<void> {
		// Concatenate accumulated chunks once
		const chunk =
			this.pcmChunks.length === 1
				? this.pcmChunks[0]
				: Buffer.concat(this.pcmChunks);
		const speechChecks = this.speechCheckCount;
		const chunkRms =
			this.chunkSumSq > 0
				? Math.sqrt(this.chunkSumSq / (chunk.length / BYTES_PER_SAMPLE)) / 32768
				: 0;

		if (isFinal) {
			// Final flush: reset state, transcript starts fresh after this
			this.pcmChunks = [];
			this.pcmChunkBytes = 0;
			this.speechCheckCount = 0;
			this.silenceCheckCount = 0;
			this.isInSpeech = false;
			this.chunkSumSq = 0;
			this.lastDraftCheck = 0;
		} else {
			// Draft flush: keep accumulating audio for the final flush.
			this.pcmChunks = [];
			this.pcmChunkBytes = 0;
			this.chunkSumSq = 0;
			this.lastDraftCheck = this.speechCheckCount;
		}

		const durationMs = (chunk.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;

		loggers.stt.debug(
			'%s %d ms (%d checks) for %s',
			isFinal ? 'Flushing' : 'Draft',
			durationMs.toFixed(0),
			speechChecks,
			this.participantId,
		);

		// Active-speaker-only mode: discard audio from non-active speakers
		if (this.isActiveSpeaker && !this.isActiveSpeaker()) {
			loggers.stt.debug(
				'Speaker %s not active, discarding %d ms chunk',
				this.participantId,
				durationMs.toFixed(0),
			);
			return;
		}

		// Skip chunks that are too short to transcribe meaningfully
		if (chunk.length < BYTES_PER_CHECK * MIN_TAIL_CHECKS) {
			loggers.stt.debug('Chunk too short, skipping');
			return;
		}

		try {
			// Normalize audio to target RMS (-20 dBFS) so quiet speakers
			// are boosted and loud speakers are attenuated.
			const normalized = this.normalizeAudio(chunk, -20, chunkRms);
			// Pass onTranscript as per-segment callback so segments
			// stream to the frontend incrementally as Whisper decodes them
			const result = await this.transcribeWithTimeout(
				normalized,
				TRANSCRIBE_TIMEOUT_MS,
				(segText: string) => {
					this.onTranscript(segText, false, durationMs);
				},
			);
			const rawText = result.text?.trim();
			if (rawText) {
				const polished = this.postProcessText(rawText);
				this.onTranscript(polished, isFinal, durationMs);
			} else if (isFinal) {
				// Clear placeholder on final flush when nothing transcribed
				this.onTranscript('', true, 0);
			}
		} catch (error) {
			loggers.stt.error(
				'Transcription failed for %s: %s',
				this.participantId,
				(error as Error).message,
			);
			if (isFinal) {
				this.onTranscript('', true, 0);
			}
		} finally {
			// Catch-up flush: if audio accumulated during transcription,
			// flush it even if MIN_SPEECH_CHECKS isn't met.
			if (isFinal && this.pcmChunkBytes >= BYTES_PER_CHECK * MIN_TAIL_CHECKS) {
				this.flushBuffer(true).catch(() => {});
			}
		}
	}

	private flushDraft(): Promise<void> {
		// Fire-and-forget: transcription continues in background,
		// audio keeps accumulating for the final flush.
		return this.flushBuffer(false).catch(() => {});
	}

	private async transcribeWithTimeout(
		pcmBuffer: Buffer,
		timeoutMs: number,
		onSegment?: (text: string) => void,
	): Promise<{ text?: string }> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Transcription timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.whisperClient
				.transcribe(pcmBuffer, SAMPLE_RATE, onSegment)
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private calculateSumSq(buffer: Buffer): number {
		let sum = 0;
		for (let i = 0; i < buffer.length; i += BYTES_PER_SAMPLE) {
			const sample = buffer.readInt16LE(i);
			sum += sample * sample;
		}
		return sum;
	}

	/**
	 * Read exactly `n` bytes from the front of the vad queue.
	 * Handles partial buffers by splitting/consuming from the head.
	 */
	private dequeueBytes(n: number): Buffer {
		const out = Buffer.alloc(n);
		let written = 0;

		while (written < n && this.vadQueue.length > 0) {
			const head = this.vadQueue[0];
			const remaining = n - written;

			if (head.length <= remaining) {
				head.copy(out, written);
				written += head.length;
				this.vadQueue.shift();
				this.vadQueueBytes -= head.length;
			} else {
				head.copy(out, written, 0, remaining);
				this.vadQueue[0] = head.subarray(remaining);
				this.vadQueueBytes -= remaining;
				written += remaining;
			}
		}

		return out;
	}

	/**
	 * Normalize PCM audio to a target dBFS level.
	 * Whisper was trained on normalized audio; feeding it unnormalized
	 * quiet/loud audio severely degrades accuracy.
	 */
	private normalizeAudio(
		buffer: Buffer,
		targetDbFs: number,
		precomputedRms?: number,
	): Buffer {
		const targetRms = 32768 * 10 ** (targetDbFs / 20);
		const currentRms =
			precomputedRms !== undefined
				? precomputedRms * 32768
				: (() => {
						let currentSum = 0;
						for (let i = 0; i < buffer.length; i += BYTES_PER_SAMPLE) {
							currentSum += buffer.readInt16LE(i) ** 2;
						}
						return Math.sqrt(currentSum / (buffer.length / BYTES_PER_SAMPLE));
					})();

		if (currentRms === 0) return buffer;

		let gain = targetRms / currentRms;
		// Hard limit to prevent clipping
		gain = Math.min(gain, 10);

		const out = Buffer.alloc(buffer.length);
		for (let i = 0; i < buffer.length; i += BYTES_PER_SAMPLE) {
			let sample = buffer.readInt16LE(i);
			sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
			out.writeInt16LE(sample, i);
		}
		return out;
	}

	/**
	 * Text post-processing for live captions.
	 * - Filters common Whisper hallucinations on silence
	 * - Deduplicates repeated words
	 * - Capitalizes first letter
	 */
	private postProcessText(text: string): string {
		let t = text.trim();
		if (!t) return t;

		// Filter common hallucinations when chunk is very short or low energy
		const lower = t.toLowerCase();
		if (
			lower === 'thank you.' ||
			lower === 'thank you' ||
			lower === 'thanks for watching.' ||
			lower === 'thanks for watching'
		) {
			return '';
		}

		// Deduplicate repeated words (e.g., "hello hello" → "hello")
		t = t.replace(/\b(\w+)\s+\1\b/gi, '$1');

		// Capitalize first letter
		t = t.charAt(0).toUpperCase() + t.slice(1);

		return t;
	}

	private buildSdp(port: number, payloadType: number): string {
		return [
			'v=0',
			'o=- 0 0 IN IP4 127.0.0.1',
			's=STT',
			'c=IN IP4 127.0.0.1',
			't=0 0',
			`m=audio ${port} RTP/AVP ${payloadType}`,
			`a=rtpmap:${payloadType} opus/48000/2`,
			'',
		].join('\n');
	}

	private findAvailablePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const socket = dgram.createSocket('udp4');
			socket.bind(0, '127.0.0.1', () => {
				const address = socket.address();
				socket.close(() => {
					resolve(address.port);
				});
			});
			socket.on('error', reject);
		});
	}
}
