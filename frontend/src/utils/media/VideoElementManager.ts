/**
 * Video Element Manager
 *
 * Manages <video> elements for participant streams and delegates audio
 * playback to an AudioMixer. The mixer owns the Web Audio graph and the
 * single shared <audio> output element; this class is only responsible
 * for video lifecycle and acting as a thin facade so existing callers
 * (Meeting.vue, useMediaControls.ts) don't need to know the audio topology.
 */
import { selectedSpeakerId } from "../../data/mediaPreferences";
import { AudioMixer, MIXER_OUTPUT_KEY } from "./AudioMixer";

interface DeferredAttachment {
	stream: MediaStream;
	isLocal: boolean;
}

const STALE_REATTACH_MS = 60_000;

export class VideoElementManager {
	videoElements: Map<string, HTMLVideoElement>;
	audioElements: Map<string, HTMLAudioElement>;
	deferredAttachments: Map<string, DeferredAttachment>;
	private lastVideoAttachAt: Map<string, number>;
	mixer: AudioMixer;

	constructor() {
		this.videoElements = new Map();
		this.audioElements = new Map();
		this.deferredAttachments = new Map();
		this.lastVideoAttachAt = new Map();
		this.mixer = new AudioMixer(selectedSpeakerId.value, (el) => {
			if (el) {
				this.audioElements.set(MIXER_OUTPUT_KEY, el);
			} else {
				this.audioElements.delete(MIXER_OUTPUT_KEY);
			}
		});
	}

	registerVideoElement(participantId: string, element: HTMLElement): void {
		if (!element || !participantId) return;

		const videoEl = element as HTMLVideoElement;
		const previousElement = this.videoElements.get(participantId);
		const previousVideoStream =
			previousElement?.srcObject as MediaStream | null;

		// Only update srcObject if element doesn't have one, or if we're re-registering with a different track
		if (previousVideoStream && !videoEl.srcObject) {
			console.log("Preserving stream during video element re-registration", {
				participantId,
				streamId: previousVideoStream.id,
				trackCount: previousVideoStream.getTracks().length,
			});

			const videoTracks = previousVideoStream.getVideoTracks();
			if (videoTracks.length > 0) {
				const previousVideoTrack = videoTracks[0];
				const existingVideoTrack = (
					videoEl.srcObject as MediaStream
				)?.getVideoTracks?.()?.[0];
				const videoTrackChanged =
					!existingVideoTrack ||
					existingVideoTrack.id !== previousVideoTrack.id;

				if (!videoEl.srcObject || videoTrackChanged) {
					videoEl.srcObject = new MediaStream(videoTracks);
				}
			}
			// we have a separate audio element for audio playback
			videoEl.muted = true;
		}

		this.videoElements.set(participantId, videoEl);

		if (this.deferredAttachments.has(participantId)) {
			const { stream, isLocal } = this.deferredAttachments.get(
				participantId,
			) as DeferredAttachment;
			this.attachStream(participantId, stream, isLocal);
			this.deferredAttachments.delete(participantId);
		}
	}

	async attachStream(
		participantId: string,
		stream: MediaStream,
		isLocal = false,
	): Promise<void> {
		const videoElement = this.videoElements.get(participantId);
		const audioTracks = stream.getAudioTracks();

		// Always attach audio for remote participants, even if no video element exists
		if (!isLocal && audioTracks.length > 0) {
			this.attachAudioStream(participantId, audioTracks);
		}

		// Only defer if we have video tracks and no video element
		// Audio-only streams don't need video elements, so don't defer them
		if (!videoElement && !isLocal && stream.getVideoTracks().length > 0) {
			this.deferredAttachments.set(participantId, { stream, isLocal });
			return;
		}

		if (videoElement) {
			const videoTracks = stream.getVideoTracks();

			if (videoTracks.length > 0) {
				const newVideoTrack = videoTracks[0];
				const existingVideoTrack = (
					videoElement.srcObject as MediaStream | null
				)?.getVideoTracks?.()?.[0];
				const lastAttach = this.lastVideoAttachAt.get(participantId);
				const isStale =
					lastAttach !== undefined &&
					Date.now() - lastAttach > STALE_REATTACH_MS;
				const videoTrackChanged =
					!existingVideoTrack || existingVideoTrack.id !== newVideoTrack.id;

				if (!videoElement.srcObject || videoTrackChanged || isStale) {
					console.log(`Attaching video track for ${participantId}`, {
						trackId: newVideoTrack.id,
						hadExisting: !!existingVideoTrack,
						changed: videoTrackChanged,
						stale: isStale,
					});
					const videoStream = new MediaStream(videoTracks);
					videoElement.srcObject = videoStream;
					// we have a separate audio element for audio playback
					videoElement.muted = true;
					this.lastVideoAttachAt.set(participantId, Date.now());

					try {
						await videoElement.play();
					} catch (err) {
						console.error(`Error playing video for ${participantId}:`, err);
					}
				} else {
					console.log(
						`Skipping video re-attach for ${participantId} - same track`,
					);
				}
			}
		}
	}

	attachAudioStream(
		participantId: string,
		audioTracks: MediaStreamTrack[],
	): void {
		const newAudioTrack = audioTracks[0];
		if (!newAudioTrack) return;
		this.mixer.attachParticipant(participantId, newAudioTrack);
	}

	async setSinkId(sinkId: string): Promise<void> {
		await this.mixer.setSinkId(sinkId);
	}

	setParticipantVolume(participantId: string, gain: number): void {
		this.mixer.setParticipantVolume(participantId, gain);
	}

	setMasterVolume(gain: number): void {
		this.mixer.setMasterVolume(gain);
	}

	async playVideo(
		element: HTMLVideoElement,
		participantId: string,
	): Promise<boolean> {
		try {
			await element.play();
			return true;
		} catch (error) {
			if ((error as DOMException).name === "NotAllowedError") {
				console.warn(
					`Autoplay blocked for ${participantId}, will play on user interaction`,
				);
				this.addUserInteractionHandler(element, participantId);
			} else {
				console.warn(
					`Video play failed for ${participantId}:`,
					(error as Error).message,
				);
			}
			return false;
		}
	}

	addUserInteractionHandler(
		element: HTMLVideoElement,
		participantId: string,
	): void {
		const playOnInteraction = async () => {
			try {
				await element.play();

				document.removeEventListener("click", playOnInteraction);
				document.removeEventListener("touchstart", playOnInteraction);
			} catch (error) {
				console.warn(
					`Unable to play video for ${participantId}:`,
					(error as Error).message,
				);
			}
		};

		document.addEventListener("click", playOnInteraction, { once: true });
		document.addEventListener("touchstart", playOnInteraction, { once: true });
	}

	removeVideoElement(participantId: string): void {
		const element = this.videoElements.get(participantId);
		let hadStream = false;
		if (element?.srcObject) {
			hadStream = true;
			for (const track of (element.srcObject as MediaStream).getTracks()) {
				track.stop();
			}
			element.srcObject = null;
		}

		this.mixer.detachParticipant(participantId);

		this.videoElements.delete(participantId);
		this.deferredAttachments.delete(participantId);
		this.lastVideoAttachAt.delete(participantId);

		console.log(`Video element removed for ${participantId}`, {
			hadStream,
			elementExists: !!element,
		});
	}

	cleanup(): void {
		for (const [_participantId, element] of this.videoElements.entries()) {
			if (element?.srcObject) {
				for (const track of (element.srcObject as MediaStream).getTracks()) {
					track.stop();
				}
				element.srcObject = null;
			}
		}

		this.mixer.dispose();
		// audioElements is kept in sync via the mixer's onOutputElementChange callback

		this.videoElements.clear();
		this.deferredAttachments.clear();
		this.lastVideoAttachAt.clear();
	}
}
