/**
 * Minimal mock of the Web Audio API for jsdom. Provides just enough surface
 * for AudioMixer to run in unit tests:
 *   - AudioContext with createGain, createMediaStreamSource,
 *     createMediaStreamDestination, createDynamicsCompressor, close
 *   - GainNode / DynamicsCompressorNode with a recordable `gain` AudioParam
 *   - MediaStreamAudioSourceNode carrying a MediaStream
 *
 * The mock tracks every `connect()` / `disconnect()` call so tests can
 * assert on the wiring of the audio graph.
 */
import { vi } from "vitest";

type ParamValue = { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };

function makeParam(initial: number): ParamValue {
	return {
		value: initial,
		setTargetAtTime: vi.fn(),
	};
}

class MockAudioParam implements ParamValue {
	value: number;
	setTargetAtTime: ReturnType<typeof vi.fn>;
	constructor(initial: number) {
		this.value = initial;
		this.setTargetAtTime = vi.fn();
	}
}

interface MockAudioNode {
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

interface MockMediaStreamAudioSourceNode extends MockAudioNode {
	mediaStream: MediaStream;
}

interface MockGainNode extends MockAudioNode {
	gain: ParamValue;
}

interface MockDynamicsCompressorNode extends MockAudioNode {
	threshold: MockAudioParam;
	knee: MockAudioParam;
	ratio: MockAudioParam;
	attack: MockAudioParam;
	release: MockAudioParam;
}

interface MockMediaStreamAudioDestinationNode extends MockAudioNode {
	stream: MediaStream;
}

class MockMediaStreamSource implements MockMediaStreamAudioSourceNode {
	connect = vi.fn();
	disconnect = vi.fn();
	constructor(public mediaStream: MediaStream) {}
}

class MockGain implements MockGainNode {
	connect = vi.fn();
	disconnect = vi.fn();
	gain: ParamValue;
	constructor(initial = 1) {
		this.gain = makeParam(initial);
	}
}

class MockCompressor implements MockDynamicsCompressorNode {
	connect = vi.fn();
	disconnect = vi.fn();
	threshold = new MockAudioParam(-24);
	knee = new MockAudioParam(6);
	ratio = new MockAudioParam(4);
	attack = new MockAudioParam(0.003);
	release = new MockAudioParam(0.25);
}

class MockDestination implements MockMediaStreamAudioDestinationNode {
	connect = vi.fn();
	disconnect = vi.fn();
	stream: MediaStream;
	constructor() {
		this.stream = new MediaStream();
	}
}

interface MockAudioContext {
	currentTime: number;
	state: string;
	resume: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	createGain: () => MockGain;
	createMediaStreamSource: (s: MediaStream) => MockMediaStreamSource;
	createMediaStreamDestination: () => MockDestination;
	createDynamicsCompressor: (
		options?: DynamicsCompressorOptions,
	) => MockCompressor;
}

export function installAudioContextMock(): {
	installedContexts: MockAudioContext[];
	reset: () => void;
} {
	const installedContexts: MockAudioContext[] = [];

	class MockCtor {
		currentTime = 0;
		state = "running";
		resume = vi.fn().mockResolvedValue(undefined);
		close = vi.fn().mockResolvedValue(undefined);
		createGain: ReturnType<typeof vi.fn>;
		createMediaStreamSource: ReturnType<typeof vi.fn>;
		createMediaStreamDestination: ReturnType<typeof vi.fn>;
		createDynamicsCompressor: ReturnType<typeof vi.fn>;
		constructor() {
			this.createGain = vi.fn(() => new MockGain());
			this.createMediaStreamSource = vi.fn(
				(s: MediaStream) => new MockMediaStreamSource(s),
			);
			this.createMediaStreamDestination = vi.fn(() => new MockDestination());
			this.createDynamicsCompressor = vi.fn(
				(_options?: DynamicsCompressorOptions) => new MockCompressor(),
			);
			installedContexts.push(this as unknown as MockAudioContext);
		}
	}

	const w = window as unknown as {
		AudioContext?: unknown;
		webkitAudioContext?: unknown;
	};
	const originalAudio = w.AudioContext;
	const originalWebkit = w.webkitAudioContext;
	w.AudioContext = MockCtor;
	w.webkitAudioContext = MockCtor;

	return {
		installedContexts,
		reset: () => {
			installedContexts.length = 0;
			w.AudioContext = originalAudio;
			w.webkitAudioContext = originalWebkit;
		},
	};
}
