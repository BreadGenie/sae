import { loggers } from '../utils/logger';

export interface WhisperTranscription {
	text: string;
	segments?: Array<{
		text: string;
		start: number;
		end: number;
	}>;
}

export interface IWhisperClient {
	transcribe(
		pcmBuffer: Buffer,
		sampleRate?: number,
	): Promise<WhisperTranscription>;
	isAvailable(): boolean;
}

/**
 * HTTP client for the faster-whisper STT server.
 * Keeps a rolling prompt context so short chunks are
 * interpreted in context rather than in isolation.
 */
export class WhisperClient implements IWhisperClient {
	private serverUrl: string;
	private available = false;
	private context = '';
	private readonly maxContextLength = 80;

	constructor(serverUrl: string) {
		this.serverUrl = serverUrl.replace(/\/$/, '');

		fetch(`${this.serverUrl}/health`)
			.then((res) => {
				if (res.ok) {
					this.available = true;
					loggers.stt.info('STT server reachable at %s', this.serverUrl);
				} else {
					loggers.stt.warn(
						'STT server health check failed (status %d)',
						res.status,
					);
				}
			})
			.catch((err) => {
				loggers.stt.warn(
					'STT server unreachable at %s: %s',
					this.serverUrl,
					err.message,
				);
			});
	}

	isAvailable(): boolean {
		return this.available;
	}

	async transcribe(
		pcmBuffer: Buffer,
		sampleRate = 16000,
	): Promise<WhisperTranscription> {
		const currentContext = this.context;

		// Pad 0.5s silence before and after to give Whisper clean boundaries
		const padSamples = Math.round(sampleRate * 0.5);
		const padBytes = padSamples * 2;
		const padded = Buffer.alloc(pcmBuffer.length + padBytes * 2);
		pcmBuffer.copy(padded, padBytes);

		const wavBuffer = this.pcmToWav(padded, sampleRate);

		const formData = new FormData();
		const blob = new Blob([wavBuffer], { type: 'audio/wav' });
		formData.append('file', blob, 'chunk.wav');
		formData.append('language', 'en');
		formData.append('temperature', '0.0');
		formData.append('best_of', '1');
		formData.append('audio_ctx', '1500');
		formData.append('prompt', currentContext);

		const response = await fetch(`${this.serverUrl}/inference`, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`STT server error ${response.status}: ${errorText}`);
		}

		const data = (await response.json()) as Record<string, unknown>;
		const text = typeof data.text === 'string' ? data.text : '';
		this.updateContext(text);
		return { text };
	}

	private updateContext(newText: string): void {
		const trimmed = newText.trim();
		if (!trimmed) return;
		this.context = `${this.context} ${trimmed}`.slice(-this.maxContextLength);
	}

	private pcmToWav(
		pcmBuffer: Buffer,
		sampleRate: number,
		channels = 1,
		bitsPerSample = 16,
	): Buffer {
		const dataLength = pcmBuffer.length;
		const byteRate = (sampleRate * channels * bitsPerSample) / 8;
		const blockAlign = (channels * bitsPerSample) / 8;
		const header = Buffer.alloc(44);

		header.write('RIFF', 0);
		header.writeUInt32LE(36 + dataLength, 4);
		header.write('WAVE', 8);
		header.write('fmt ', 12);
		header.writeUInt32LE(16, 16);
		header.writeUInt16LE(1, 20);
		header.writeUInt16LE(channels, 22);
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(byteRate, 28);
		header.writeUInt16LE(blockAlign, 32);
		header.writeUInt16LE(bitsPerSample, 34);
		header.write('data', 36);
		header.writeUInt32LE(dataLength, 40);

		return Buffer.concat([header, pcmBuffer]);
	}
}

export class MockWhisperClient implements IWhisperClient {
	private callCount = 0;
	private available = true;

	isAvailable(): boolean {
		return this.available;
	}

	async transcribe(
		pcmBuffer: Buffer,
		_sampleRate = 16000,
	): Promise<WhisperTranscription> {
		this.callCount++;
		const duration = pcmBuffer.length / 2 / 16000;
		loggers.stt.info(
			'[MockWhisper] Would transcribe %d bytes (~%ds audio). Call #%d',
			pcmBuffer.length,
			duration.toFixed(1),
			this.callCount,
		);
		return {
			text: `[Mock #${this.callCount}: ~${duration.toFixed(1)}s]`,
		};
	}
}
