export class VideoElementManager {
	constructor() {
		this.videoElements = new Map();
		this.deferredAttachments = new Map();
	}

	registerVideoElement(participantId, element) {
		if (!element || !participantId) return;

		const previousElement = this.videoElements.get(participantId);
		const previousStream = previousElement?.srcObject;

		if (previousStream && !element.srcObject) {
			console.log("📺 Preserving stream during video element re-registration", {
				participantId,
				streamId: previousStream.id,
				trackCount: previousStream.getTracks().length,
			});
			element.srcObject = previousStream;
			element.muted = previousElement?.muted || false;
			if (!previousElement?.muted) {
				element
					.play()
					.catch((err) =>
						console.warn("Play failed during re-registration:", err),
					);
			}
		}

		this.videoElements.set(participantId, element);

		if (this.deferredAttachments.has(participantId)) {
			const { stream, isLocal } = this.deferredAttachments.get(participantId);
			console.log("📺 Attaching deferred stream during registration", {
				participantId,
				streamId: stream?.id,
			});
			this.attachStream(participantId, stream, isLocal);
			this.deferredAttachments.delete(participantId);
		}
	}

	async attachStream(participantId, stream, isLocal = false) {
		const element = this.videoElements.get(participantId);

		if (!element && !isLocal) {
			this.deferredAttachments.set(participantId, { stream, isLocal });
			return;
		}

		if (element) {
			element.srcObject = stream;
			element.muted = isLocal;

			const tryPlay = async () => {
				if (!element.isConnected) {
					console.warn(
						`⚠️ Video element not connected for ${participantId}, skipping play`,
					);
					return false;
				}
				try {
					await element.play();
					return true;
				} catch (err) {
					console.error(`❌ Error playing video for ${participantId}:`, err);
					return false;
				}
			};

			if (!isLocal) {
				const played = await tryPlay();
				return played;
			}

			tryPlay();
			return true;
		}
	}

	async playVideo(element, participantId) {
		try {
			await element.play();
			return true;
		} catch (error) {
			if (error.name === "NotAllowedError") {
				console.warn(
					`⚠️ Autoplay blocked for ${participantId}, will play on user interaction`,
				);
				this.addUserInteractionHandler(element, participantId);
			} else {
				console.warn(
					`⚠️ Video play failed for ${participantId}:`,
					error.message,
				);
			}
			return false;
		}
	}

	addUserInteractionHandler(element, participantId) {
		const playOnInteraction = async () => {
			try {
				await element.play();

				document.removeEventListener("click", playOnInteraction);
				document.removeEventListener("touchstart", playOnInteraction);
			} catch (error) {
				console.warn(
					`⚠️ Unable to play video for ${participantId}:`,
					error.message,
				);
			}
		};

		document.addEventListener("click", playOnInteraction, { once: true });
		document.addEventListener("touchstart", playOnInteraction, { once: true });
	}

	removeVideoElement(participantId) {
		const element = this.videoElements.get(participantId);
		let hadStream = false;
		if (element?.srcObject) {
			hadStream = true;
			try {
				for (const track of element.srcObject.getTracks()) {
					track.stop();
				}
			} catch (_) {}
			element.srcObject = null;
		}

		this.videoElements.delete(participantId);
		this.deferredAttachments.delete(participantId);

		try {
			console.log(`🗑️ Video element removed for ${participantId}`, {
				hadStream,
				elementExists: !!element,
			});
		} catch (_) {}
	}

	createCombinedStream(videoTrack, audioTrack) {
		const combinedStream = new MediaStream();

		if (videoTrack) {
			combinedStream.addTrack(videoTrack);
		}
		if (audioTrack) {
			combinedStream.addTrack(audioTrack);
		}

		return combinedStream;
	}

	cleanup() {
		for (const [participantId, element] of this.videoElements.entries()) {
			if (element?.srcObject) {
				for (const track of element.srcObject.getTracks()) {
					track.stop();
				}
				element.srcObject = null;
			}
		}

		this.videoElements.clear();
		this.deferredAttachments.clear();
	}
}
