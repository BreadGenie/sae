import { onUnmounted, type Ref, ref } from "vue";

interface NoiseCancellationResult {
	stream: MediaStream;
	cleanup: () => void;
}

interface UseNoiseCancellationReturn {
	isProcessing: Ref<boolean>;
	processedStream: Ref<MediaStream | null>;
	error: Ref<string | null>;
	applyNoiseCancellation: (
		inputStream: MediaStream,
	) => Promise<NoiseCancellationResult>;
	stopProcessing: () => void;
}

const registeredContexts = new WeakSet<AudioContext>();
let workletRegistrationPromise: Promise<void> | null = null;

async function registerWorklet(audioContext: AudioContext): Promise<void> {
	if (registeredContexts.has(audioContext)) {
		return;
	}

	if (workletRegistrationPromise) {
		return workletRegistrationPromise;
	}

	workletRegistrationPromise = (async () => {
		try {
			const workletUrl = await import(
				"@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url"
			);

			await audioContext.audioWorklet.addModule(workletUrl.default);

			registeredContexts.add(audioContext);
		} finally {
			workletRegistrationPromise = null;
		}
	})();

	return workletRegistrationPromise;
}

/**
 * Composable for noise cancellation using RNNoise
 */
export function useNoiseCancellation(): UseNoiseCancellationReturn {
	const isProcessing = ref<boolean>(false);
	const processedStream = ref<MediaStream | null>(null);
	const error = ref<string | null>(null);

	let audioContext: AudioContext | null = null;
	let sourceNode: MediaStreamAudioSourceNode | null = null;
	let destinationNode: MediaStreamAudioDestinationNode | null = null;
	let noiseSuppressorNode: AudioWorkletNode | null = null;

	async function applyNoiseCancellation(
		inputStream: MediaStream,
	): Promise<NoiseCancellationResult> {
		const audioTrack = inputStream.getAudioTracks()[0];
		if (!audioTrack) {
			return {
				stream: inputStream,
				cleanup: () => {},
			};
		}

		try {
			isProcessing.value = true;
			error.value = null;

			stopProcessing();

			// RNNoise expects 48kHz sample rate
			audioContext = new AudioContext({ sampleRate: 48000 });

			await registerWorklet(audioContext);

			const { NoiseSuppressorWorklet_Name } = await import(
				"@timephy/rnnoise-wasm"
			);

			noiseSuppressorNode = new AudioWorkletNode(
				audioContext,
				NoiseSuppressorWorklet_Name,
			);

			const audioOnlyStream = new MediaStream([audioTrack]);
			sourceNode = audioContext.createMediaStreamSource(audioOnlyStream);

			destinationNode = audioContext.createMediaStreamDestination();

			// connect the audio graph: source -> noise suppressor -> destination
			sourceNode.connect(noiseSuppressorNode);
			noiseSuppressorNode.connect(destinationNode);

			const outputStream = destinationNode.stream;
			processedStream.value = outputStream;

			return {
				stream: outputStream,
				cleanup: stopProcessing,
			};
		} catch (err) {
			console.error("[RNNoise] Failed to apply noise cancellation:", err);
			error.value =
				err instanceof Error
					? err.message
					: "Failed to apply noise cancellation";
			isProcessing.value = false;

			return {
				stream: inputStream,
				cleanup: () => {},
			};
		}
	}

	function stopProcessing(): void {
		isProcessing.value = false;

		if (sourceNode) {
			try {
				sourceNode.disconnect();
			} catch (e) {
				console.warn("Failed to disconnect source node:", e);
			}
			sourceNode = null;
		}

		if (noiseSuppressorNode) {
			try {
				noiseSuppressorNode.disconnect();
			} catch (e) {
				console.warn("Failed to disconnect noise suppressor node:", e);
			}
			noiseSuppressorNode = null;
		}

		if (audioContext && audioContext.state !== "closed") {
			try {
				audioContext.close();
			} catch (e) {
				console.warn("Failed to close AudioContext:", e);
			}
			audioContext = null;
		}

		destinationNode = null;
		processedStream.value = null;
	}

	onUnmounted(() => {
		stopProcessing();
	});

	return {
		isProcessing,
		processedStream,
		error,
		applyNoiseCancellation,
		stopProcessing,
	};
}
