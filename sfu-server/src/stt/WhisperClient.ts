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
		onSegment?: (text: string) => void,
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

	private queue: Array<{
		pcmBuffer: Buffer;
		sampleRate: number;
		createdAt: number;
		onSegment?: (text: string) => void;
		resolve: (result: WhisperTranscription) => void;
		reject: (error: Error) => void;
	}> = [];
	private processing = false;

	private readonly maxQueueLength = 2;
	private readonly maxQueueAgeMs = 3_000;

	private healthCheckTimer: NodeJS.Timeout | null = null;
	private readonly healthCheckIntervalMs = 10_000; // retry every 10s until available

	constructor(serverUrl: string) {
		this.serverUrl = serverUrl.replace(/\/$/, '');

		this.checkHealth();
		this.startHealthCheckLoop();
	}

	private startHealthCheckLoop(): void {
		this.healthCheckTimer = setInterval(() => {
			if (this.available) {
				if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
				this.healthCheckTimer = null;
			} else {
				this.checkHealth();
			}
		}, this.healthCheckIntervalMs);
	}

	private checkHealth(): void {
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
				loggers.stt.debug(
					'STT server unreachable at %s: %s',
					this.serverUrl,
					err.message,
				);
			});
	}

	destroy(): void {
		if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
		this.healthCheckTimer = null;
	}

	isAvailable(): boolean {
		return this.available;
	}

	async transcribe(
		pcmBuffer: Buffer,
		sampleRate = 16000,
		onSegment?: (text: string) => void,
	): Promise<WhisperTranscription> {
		return new Promise((resolve, reject) => {
			// Cap queue length to prevent unbounded backlog
			while (this.queue.length >= this.maxQueueLength) {
				const dropped = this.queue.shift()!;
				loggers.stt.debug(
					'Dropping oldest queue item (age %dms)',
					Date.now() - dropped.createdAt,
				);
				dropped.reject(new Error('Dropped: queue full'));
			}
			this.queue.push({
				pcmBuffer,
				sampleRate,
				createdAt: Date.now(),
				onSegment,
				resolve,
				reject,
			});
			this.processQueue();
		});
	}

	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;

		// Drop stale jobs before processing
		while (this.queue.length > 0) {
			const front = this.queue[0];
			if (Date.now() - front.createdAt > this.maxQueueAgeMs) {
				const stale = this.queue.shift()!;
				loggers.stt.warn(
					'Dropping stale transcription job (age %dms, %d bytes)',
					Date.now() - stale.createdAt,
					stale.pcmBuffer.length,
				);
				stale.reject(new Error('Dropped: transcription too stale'));
			} else {
				break;
			}
		}

		if (this.queue.length === 0) {
			this.processing = false;
			return;
		}

		const { pcmBuffer, onSegment, resolve, reject } = this.queue.shift()!;
		try {
			const result = await this.doTranscribe(pcmBuffer, onSegment);
			resolve(result);
		} catch (error) {
			reject(error as Error);
		} finally {
			this.processing = false;
			this.processQueue();
		}
	}

	private async doTranscribe(
		pcmBuffer: Buffer,
		onSegment?: (text: string) => void,
	): Promise<WhisperTranscription> {
		const response = await fetch(`${this.serverUrl}/transcribe-pcm`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
			},
			body: pcmBuffer,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`STT server error ${response.status}: ${errorText}`);
		}

		// Parse SSE stream: data: {"text": "...", "isFinal": true}
		const texts: string[] = [];
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // keep incomplete line in buffer

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const jsonStr = line.slice(6).trim();
				if (!jsonStr) continue;

				try {
					const data = JSON.parse(jsonStr) as Record<string, unknown>;
					const text = typeof data.text === 'string' ? data.text.trim() : '';
					if (text) {
						texts.push(text);
						if (onSegment) onSegment(text);
					}
				} catch {
					// skip malformed JSON
				}
			}
		}

		const fullText = texts.join(' ');
		this.updateContext(fullText);
		return {
			text: fullText,
			segments: texts.map((t) => ({ text: t, start: 0, end: 0 })),
		};
	}

	private updateContext(newText: string): void {
		const trimmed = newText.trim();
		if (!trimmed) return;
		this.context = `${this.context} ${trimmed}`.slice(-this.maxContextLength);
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
		_onSegment?: (text: string) => void,
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
