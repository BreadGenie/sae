/**
 * AudioMixer
 *
 * Receives remote audio tracks from a mediasoup consumer (or any source that
 * hands us a MediaStreamTrack) and routes them through a shared Web Audio
 * graph so we can apply per-participant gain and dynamics compression
 * before the mixed signal reaches the speakers.
 *
 * Graph per participant:
 *   MediaStreamAudioSourceNode -> GainNode (per-user)
 *                             -> DynamicsCompressorNode (per-user)
 *                             -> master GainNode
 *                             -> MediaStreamAudioDestinationNode
 *                             -> shared hidden <audio> element
 *
 * The mixer's output <audio> is exposed via `outputElement` so callers can
 * route it to a specific output device with setSinkId without having to
 * understand the Web Audio graph.
 *
 * The AudioContext is created lazily on the first call to attachParticipant.
 * Browsers require a user gesture before the context can start producing
 * sound; we register a one-shot click/touchstart listener that resumes
 * playback if autoplay is blocked.
 */

const COMPRESSOR_DEFAULTS: DynamicsCompressorOptions = {
	threshold: -24,
	knee: 6,
	ratio: 4,
	attack: 0.003,
	release: 0.25,
};

/**
 * Sentinel key under which the single shared <audio> output element is
 * stored in VideoElementManager.audioElements. The mixer's output element
 * is not per-participant; the sentinel makes this explicit and lets the
 * existing setSinkId iteration in Meeting.vue / useMediaControls.ts keep
 * working without changes.
 */
export const MIXER_OUTPUT_KEY = "__mixer__";

interface ParticipantChain {
	source: MediaStreamAudioSourceNode;
	gain: GainNode;
	compressor: DynamicsCompressorNode;
}

export class AudioMixer {
	private audioContext: AudioContext | null;
	private masterGain: GainNode | null;
	private destination: MediaStreamAudioDestinationNode | null;
	private outputElement: HTMLAudioElement | null;
	private chains: Map<string, ParticipantChain>;
	private sinkId: string;
	private onOutputElementChange: ((el: HTMLAudioElement | null) => void) | null;

	constructor(
		initialSinkId = "",
		onOutputElementChange:
			| ((el: HTMLAudioElement | null) => undefined)
			| null = null,
	) {
		this.audioContext = null;
		this.masterGain = null;
		this.destination = null;
		this.outputElement = null;
		this.chains = new Map();
		this.sinkId = initialSinkId;
		this.onOutputElementChange = onOutputElementChange;
	}

	/**
	 * Wire a remote audio track into the mixer. Idempotent for the same
	 * (participantId, trackId) pair. Replaces the chain if the track id
	 * changes (e.g. after an ICE restart).
	 */
	attachParticipant(participantId: string, track: MediaStreamTrack): void {
		const existing = this.chains.get(participantId);
		const existingTrack = existing?.source.mediaStream.getAudioTracks()[0];
		if (existing && existingTrack && existingTrack.id === track.id) {
			return;
		}

		if (existing) {
			this.detachParticipant(participantId);
		}

		this.ensureContext();
		if (!this.audioContext || !this.masterGain || !this.destination) {
			return;
		}

		const source = this.audioContext.createMediaStreamSource(
			new MediaStream([track]),
		);
		const gain = this.audioContext.createGain();
		gain.gain.value = 1;
		const compressor = (
			this.audioContext.createDynamicsCompressor as unknown as (
				options?: DynamicsCompressorOptions,
			) => DynamicsCompressorNode
		)(COMPRESSOR_DEFAULTS);

		source.connect(gain);
		gain.connect(compressor);
		compressor.connect(this.masterGain);

		this.chains.set(participantId, { source, gain, compressor });
	}

	detachParticipant(participantId: string): void {
		const chain = this.chains.get(participantId);
		if (!chain) return;
		for (const node of [chain.source, chain.gain, chain.compressor]) {
			try {
				node.disconnect();
			} catch {
				// node may already be disconnected
			}
		}
		this.chains.delete(participantId);
	}

	setParticipantVolume(participantId: string, gain: number): void {
		const chain = this.chains.get(participantId);
		if (!chain) return;
		const clamped = Math.max(0, Math.min(2, gain));
		chain.gain.gain.setTargetAtTime(
			clamped,
			this.audioContext?.currentTime ?? 0,
			0.01,
		);
	}

	setMasterVolume(gain: number): void {
		if (!this.masterGain || !this.audioContext) return;
		const clamped = Math.max(0, Math.min(2, gain));
		this.masterGain.gain.setTargetAtTime(
			clamped,
			this.audioContext.currentTime,
			0.01,
		);
	}

	async setSinkId(sinkId: string): Promise<void> {
		this.sinkId = sinkId;
		const el = this.outputElement;
		if (!el) return;
		await (
			el as HTMLAudioElement & {
				setSinkId?: (id: string) => Promise<void>;
			}
		).setSinkId?.(sinkId);
	}

	/**
	 * Tear down the entire mixer: disconnect all participant chains, stop
	 * the output element, close the AudioContext. Safe to call multiple times.
	 */
	dispose(): void {
		for (const participantId of this.chains.keys()) {
			this.detachParticipant(participantId);
		}
		this.chains.clear();

		if (this.outputElement) {
			if (this.outputElement.srcObject) {
				for (const track of (
					this.outputElement.srcObject as MediaStream
				).getTracks()) {
					track.stop();
				}
				this.outputElement.srcObject = null;
			}
			this.outputElement.remove();
			this.outputElement = null;
			this.onOutputElementChange?.(null);
		}

		if (this.audioContext) {
			this.audioContext.close().catch((err: Error) => {
				console.warn("Failed to close AudioContext:", err.message);
			});
		}
		this.audioContext = null;
		this.masterGain = null;
		this.destination = null;
	}

	/** Exposed for tests; do not use in app code. */
	get _audioContext(): AudioContext | null {
		return this.audioContext;
	}

	get _outputElement(): HTMLAudioElement | null {
		return this.outputElement;
	}

	get _participantIds(): string[] {
		return Array.from(this.chains.keys());
	}

	_getChain(participantId: string): ParticipantChain | undefined {
		return this.chains.get(participantId);
	}

	private ensureContext(): void {
		if (this.audioContext && this.destination) {
			return;
		}

		const AudioContextCtor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!AudioContextCtor) {
			console.warn(
				"Web Audio API not supported; remote audio will not be processed.",
			);
			return;
		}

		const context = new AudioContextCtor();
		const masterGain = context.createGain();
		masterGain.gain.value = 1;
		const destination = context.createMediaStreamDestination();
		masterGain.connect(destination);

		const outputElement = document.createElement("audio");
		outputElement.autoplay = true;
		outputElement.setAttribute("playsinline", "");
		outputElement.style.display = "none";
		outputElement.srcObject = destination.stream;
		document.body.appendChild(outputElement);

		this.audioContext = context;
		this.masterGain = masterGain;
		this.destination = destination;
		this.outputElement = outputElement;
		this.onOutputElementChange?.(outputElement);

		if (this.sinkId) {
			(
				outputElement as HTMLAudioElement & {
					setSinkId?: (id: string) => Promise<void>;
				}
			)
				.setSinkId?.(this.sinkId)
				.catch((err: Error) => {
					console.warn("Failed to set initial speaker on mixer output:", err);
				});
		}

		const startPlayback = () => {
			outputElement.play().catch((err: Error) => {
				console.warn("Audio mixer autoplay failed:", err.message);
			});
		};
		startPlayback();
		document.addEventListener("click", startPlayback, { once: true });
		document.addEventListener("touchstart", startPlayback, { once: true });
	}
}
