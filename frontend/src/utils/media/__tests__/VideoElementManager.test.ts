import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMixer, MIXER_OUTPUT_KEY } from "../AudioMixer";
import { VideoElementManager } from "../VideoElementManager";
import { installAudioContextMock } from "./audioContextMock";

type StreamCtor = new (tracks: MediaStreamTrack[]) => MediaStream;

const globalAny = globalThis as unknown as { MediaStream?: StreamCtor };

beforeEach(() => {
	if (globalAny.MediaStream === undefined) {
		class MockMediaStream {
			tracks: MediaStreamTrack[];
			id: string;
			constructor(tracks: MediaStreamTrack[] = []) {
				this.tracks = tracks;
				this.id = `mock-${Math.random().toString(36).slice(2)}`;
			}
			getVideoTracks() {
				return this.tracks.filter((t) => t.kind === "video");
			}
			getAudioTracks() {
				return this.tracks.filter((t) => t.kind === "audio");
			}
			getTracks() {
				return this.tracks;
			}
		}
		globalAny.MediaStream = MockMediaStream as unknown as StreamCtor;
	}
});

function makeTrack(
	id: string,
	kind: "audio" | "video" = "video",
): MediaStreamTrack {
	return {
		id,
		kind,
		stop: vi.fn(),
	} as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[]): MediaStream {
	const Ctor = globalAny.MediaStream as StreamCtor;
	return new Ctor(tracks);
}

function makeVideoElement(): HTMLVideoElement {
	const el = document.createElement("video");
	el.play = vi.fn().mockResolvedValue(undefined) as never;
	return el;
}

describe("VideoElementManager video element lifecycle", () => {
	let manager: VideoElementManager;

	beforeEach(() => {
		manager = new VideoElementManager();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-attaches a new track with a different id", async () => {
		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-1",
		);

		const track2 = makeTrack("track-2");
		await manager.attachStream("p1", makeStream([track2]), false);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-2",
		);
	});

	it("skips re-attach when track id is unchanged", async () => {
		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		const originalSrc = el.srcObject;

		await manager.attachStream("p1", makeStream([track1]), false);
		expect(el.srcObject).toBe(originalSrc);
	});

	it("re-attaches when the last attach is older than the stale threshold", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_000_000));

		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		const track1 = makeTrack("track-1");
		await manager.attachStream("p1", makeStream([track1]), false);
		const originalSrc = el.srcObject;

		vi.setSystemTime(new Date(1_000_000 + 70_000));

		await manager.attachStream("p1", makeStream([track1]), false);
		expect(el.srcObject).not.toBe(originalSrc);
		expect((el.srcObject as MediaStream).getVideoTracks()[0].id).toBe(
			"track-1",
		);
	});

	it("clears the attach timestamp when the element is removed", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1_000_000));

		const el = makeVideoElement();
		manager.registerVideoElement("p1", el);
		await manager.attachStream("p1", makeStream([makeTrack("t1")]), false);

		manager.removeVideoElement("p1");

		const el2 = makeVideoElement();
		manager.registerVideoElement("p1", el2);
		await manager.attachStream("p1", makeStream([makeTrack("t1")]), false);
		expect((el2.srcObject as MediaStream).getVideoTracks()[0].id).toBe("t1");
	});

	it("does not attach audio for local streams", () => {
		manager.attachStream("p1", makeStream([makeTrack("a1", "audio")]), true);
		expect(manager.audioElements.size).toBe(0);
	});
});

describe("VideoElementManager audio mixer integration", () => {
	let mock: ReturnType<typeof installAudioContextMock>;
	let manager: VideoElementManager;

	beforeEach(() => {
		mock = installAudioContextMock();
		// jsdom does not implement HTMLMediaElement.play(); stub it so the
		// mixer can call it without throwing.
		HTMLMediaElement.prototype.play = vi
			.fn()
			.mockResolvedValue(undefined) as never;
		manager = new VideoElementManager();
	});

	afterEach(() => {
		manager.cleanup();
		mock.reset();
	});

	it("does not create an AudioContext until the first remote audio attach", () => {
		expect(mock.installedContexts).toHaveLength(0);
		expect(manager.audioElements.size).toBe(0);
	});

	it("creates a single shared output <audio> on the first remote audio attach", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		expect(mock.installedContexts).toHaveLength(1);
		expect(manager.audioElements.size).toBe(1);
		expect(manager.audioElements.has(MIXER_OUTPUT_KEY)).toBe(true);
	});

	it("routes a second remote track through the same mixer (no second AudioContext)", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		manager.attachAudioStream("p2", [makeTrack("a2", "audio")]);
		expect(mock.installedContexts).toHaveLength(1);
		expect(manager.audioElements.size).toBe(1);
	});

	it("removes a participant from the mixer when removeVideoElement is called", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		manager.attachAudioStream("p2", [makeTrack("a2", "audio")]);
		const ctx = manager.mixer._audioContext as unknown as {
			createMediaStreamSource: ReturnType<typeof vi.fn>;
		};
		expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);

		manager.removeVideoElement("p1");
		// Source for p1 should have been disconnected.
		const allSources = ctx.createMediaStreamSource.mock.results.flatMap(
			(r) => r.value as { disconnect: ReturnType<typeof vi.fn> },
		);
		const p1Source = allSources[0];
		expect(p1Source.disconnect).toHaveBeenCalled();
	});

	it("replaces a participant's chain when their audio track id changes", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		manager.attachAudioStream("p1", [makeTrack("a2", "audio")]);
		const ctx = manager.mixer._audioContext as unknown as {
			createMediaStreamSource: ReturnType<typeof vi.fn>;
		};
		// Old chain disconnected, new source created
		expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);
	});

	it("does not re-create a chain when reattaching the same track id", () => {
		const track = makeTrack("a1", "audio");
		manager.attachAudioStream("p1", [track]);
		manager.attachAudioStream("p1", [track]);
		manager.attachAudioStream("p1", [track]);
		const ctx = manager.mixer._audioContext as unknown as {
			createMediaStreamSource: ReturnType<typeof vi.fn>;
		};
		// Idempotent: one chain for the same track id, regardless of how
		// many times the consumer reannounces it.
		expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(1);
		expect(manager.mixer._participantIds).toEqual(["p1"]);
	});

	it("exposes setParticipantVolume and setMasterVolume", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		expect(() => manager.setParticipantVolume("p1", 0.5)).not.toThrow();
		expect(() => manager.setMasterVolume(0.8)).not.toThrow();
	});

	it("setSinkId is forwarded to the shared output element", async () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		const out = manager.audioElements.get(MIXER_OUTPUT_KEY) as
			| (HTMLAudioElement & { setSinkId: ReturnType<typeof vi.fn> })
			| undefined;
		expect(out).toBeDefined();
		(out as { setSinkId: ReturnType<typeof vi.fn> }).setSinkId = vi
			.fn()
			.mockResolvedValue(undefined);
		await manager.setSinkId("sink-1");
		expect(out?.setSinkId).toHaveBeenCalledWith("sink-1");
	});

	it("cleanup disposes the mixer and clears the audio map", () => {
		manager.attachAudioStream("p1", [makeTrack("a1", "audio")]);
		const ctx = manager.mixer._audioContext as unknown as {
			close: ReturnType<typeof vi.fn>;
		};
		manager.cleanup();
		expect(ctx.close).toHaveBeenCalled();
		expect(manager.audioElements.size).toBe(0);
	});
});

describe("AudioMixer", () => {
	let mock: ReturnType<typeof installAudioContextMock>;
	let mixer: AudioMixer;

	beforeEach(() => {
		mock = installAudioContextMock();
		HTMLMediaElement.prototype.play = vi
			.fn()
			.mockResolvedValue(undefined) as never;
		mixer = new AudioMixer();
	});

	afterEach(() => {
		mixer.dispose();
		mock.reset();
	});

	it("creates the AudioContext lazily on first attach", () => {
		expect(mock.installedContexts).toHaveLength(0);
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		expect(mock.installedContexts).toHaveLength(1);
	});

	it("wires the per-participant chain into the master gain", () => {
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		const chain = mixer._getChain("p1");
		expect(chain).toBeDefined();
		if (!chain) return;
		const ctx = mixer._audioContext as unknown as {
			createMediaStreamSource: ReturnType<typeof vi.fn>;
			createDynamicsCompressor: ReturnType<typeof vi.fn>;
		};
		const source = ctx.createMediaStreamSource.mock.results[0].value as {
			connect: ReturnType<typeof vi.fn>;
		};
		const compressor = ctx.createDynamicsCompressor.mock.results[0].value as {
			connect: ReturnType<typeof vi.fn>;
		};

		expect(source.connect).toHaveBeenCalledWith(chain.gain);
		expect(chain.gain.connect).toHaveBeenCalledWith(compressor);
	});

	it("applies voice-tuned defaults to the compressor", () => {
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		const ctx = mixer._audioContext as unknown as {
			createDynamicsCompressor: ReturnType<typeof vi.fn>;
		};
		expect(ctx.createDynamicsCompressor).toHaveBeenCalledWith(
			expect.objectContaining({
				threshold: -24,
				knee: 6,
				ratio: 4,
				attack: 0.003,
				release: 0.25,
			}),
		);
	});

	it("clamps setParticipantVolume to [0, 2]", () => {
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		const chain = mixer._getChain("p1");
		expect(chain).toBeDefined();
		if (!chain) return;

		mixer.setParticipantVolume("p1", 5);
		expect(chain.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
			2,
			expect.any(Number),
			0.01,
		);

		mixer.setParticipantVolume("p1", -1);
		expect(chain.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(
			0,
			expect.any(Number),
			0.01,
		);
	});

	it("is a no-op to setParticipantVolume for an unknown participant", () => {
		expect(() => mixer.setParticipantVolume("nope", 0.5)).not.toThrow();
	});

	it("disconnectParticipant disconnects source, gain, and compressor", () => {
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		const chain = mixer._getChain("p1");
		expect(chain).toBeDefined();
		if (!chain) return;

		mixer.detachParticipant("p1");

		expect(chain.source.disconnect).toHaveBeenCalled();
		expect(chain.gain.disconnect).toHaveBeenCalled();
		expect(chain.compressor.disconnect).toHaveBeenCalled();
		expect(mixer._participantIds).toEqual([]);
	});

	it("dispose closes the AudioContext and removes the output element", () => {
		mixer.attachParticipant("p1", makeTrack("a1", "audio"));
		const ctx = mixer._audioContext as unknown as {
			close: ReturnType<typeof vi.fn>;
		};
		const out = mixer._outputElement;
		expect(out).toBeTruthy();
		expect(out?.parentNode).toBe(document.body);

		mixer.dispose();

		expect(ctx.close).toHaveBeenCalled();
		expect(mixer._outputElement).toBeNull();
	});

	it("dispose is idempotent", () => {
		mixer.dispose();
		expect(() => mixer.dispose()).not.toThrow();
	});
});
