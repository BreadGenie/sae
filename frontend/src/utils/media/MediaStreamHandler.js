/**
 * MediaStreamHandler
 * Utility class to manage user media and screen sharing streams.
 */

export class MediaStreamHandler {
	constructor() {
		this.localStream = null;
		this.screenShareStream = null;
		this.videoProducer = null;
		this.audioProducer = null;
		this.screenProducer = null;
		// Placeholder tracks used when user disables camera/mic but we want to keep
		// the mediasoup Producer objects alive. These tracks are silent/blank and
		// allow replacing the real device tracks so the camera/mic hardware can be
		// stopped without closing the Producer.
		this._blankVideoTrack = null;
		this._blankAudioTrack = null;
		this._blankAudioOsc = null;
		this._audioCtx = null;
	}

	async getUserMedia(
		constraints = { video: true, audio: true },
		deviceIds = {},
	) {
		try {
			const fullConstraints = this.buildConstraints(constraints, deviceIds);
			const stream = await navigator.mediaDevices.getUserMedia(fullConstraints);
			this.localStream = stream;
			return stream;
		} catch (error) {
			console.error("❌ Failed to get user media:", error);
			throw error;
		}
	}

	// constrainsts for getUserMedia with optional device IDs
	buildConstraints(baseConstraints = {}, deviceIds = {}) {
		const constraints = { ...baseConstraints };

		if (constraints.video && typeof constraints.video === "object") {
			constraints.video = { ...constraints.video };
			if (deviceIds.camera) {
				constraints.video.deviceId = { exact: deviceIds.camera };
			}
		} else if (constraints.video === true) {
			constraints.video = {};
			if (deviceIds.camera) {
				constraints.video.deviceId = { exact: deviceIds.camera };
			}
		}

		if (constraints.audio && typeof constraints.audio === "object") {
			constraints.audio = { ...constraints.audio };
			if (deviceIds.microphone) {
				constraints.audio.deviceId = { exact: deviceIds.microphone };
			}
		} else if (constraints.audio === true) {
			constraints.audio = {};
			if (deviceIds.microphone) {
				constraints.audio.deviceId = { exact: deviceIds.microphone };
			}
		}

		return constraints;
	}
	async getScreenShare() {
		try {
			console.log("🖥️ Requesting screen share");
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: false,
			});
			this.screenShareStream = stream;
			return stream;
		} catch (error) {
			console.error("❌ Failed to get screen share:", error);
			throw error;
		}
	}

	toggleVideo(enabled) {
		if (this.localStream) {
			const videoTrack = this.localStream.getVideoTracks()[0];
			if (videoTrack) {
				videoTrack.enabled = enabled;
				console.log(`🎥 Video ${enabled ? "enabled" : "disabled"}`);
				return true;
			}
		}
		return false;
	}

	toggleAudio(enabled) {
		if (this.localStream) {
			const audioTrack = this.localStream.getAudioTracks()[0];
			if (audioTrack) {
				audioTrack.enabled = enabled;
				console.log(`🎵 Audio ${enabled ? "enabled" : "disabled"}`);
				return true;
			}
		}
		return false;
	}

	async replaceVideoTrack(newConstraints) {
		try {
			const newStream = await navigator.mediaDevices.getUserMedia({
				video: newConstraints,
				audio: false,
			});

			const newVideoTrack = newStream.getVideoTracks()[0];
			const oldVideoTrack = this.localStream?.getVideoTracks()[0];

			if (this.videoProducer && newVideoTrack) {
				// Replace producer track in-place so the Producer object is reused
				// across toggles instead of being closed and recreated.
				try {
					await this.videoProducer.replaceTrack({ track: newVideoTrack });
				} catch (err) {
					console.warn("⚠️ replaceTrack failed for videoProducer", err);
				}
			}

			if (oldVideoTrack) {
				oldVideoTrack.stop();
				this.localStream.removeTrack(oldVideoTrack);
			}

			if (newVideoTrack && this.localStream) {
				this.localStream.addTrack(newVideoTrack);
			}

			return newVideoTrack;
		} catch (error) {
			console.error("❌ Failed to replace video track:", error);
			throw error;
		}
	}

	stopScreenShare() {
		if (this.screenShareStream) {
			for (const track of this.screenShareStream.getTracks()) {
				track.stop();
			}
			this.screenShareStream = null;
			console.log("🖥️ Screen share stopped");
		}
	}

	cleanup() {
		if (this.localStream) {
			for (const track of this.localStream.getTracks()) {
				track.stop();
			}
			this.localStream = null;
		}

		if (this.screenShareStream) {
			for (const track of this.screenShareStream.getTracks()) {
				track.stop();
			}
			this.screenShareStream = null;
		}

		this.videoProducer = null;
		this.audioProducer = null;
		this.screenProducer = null;
		// Stop and clear blank placeholder tracks and audio oscillator/context
		try {
			if (this._blankVideoTrack) {
				try {
					this._blankVideoTrack.stop();
				} catch (_) {}
				this._blankVideoTrack = null;
			}
			if (this._blankAudioTrack) {
				try {
					this._blankAudioTrack.stop();
				} catch (_) {}
				this._blankAudioTrack = null;
			}
			if (this._blankAudioOsc) {
				try {
					this._blankAudioOsc.stop();
				} catch (_) {}
				this._blankAudioOsc = null;
			}
			if (this._audioCtx) {
				try {
					this._audioCtx.close?.();
				} catch (_) {}
				this._audioCtx = null;
			}
		} catch (_) {}
	}

	getMediaState() {
		const videoTrack = this.localStream?.getVideoTracks()[0];
		const audioTrack = this.localStream?.getAudioTracks()[0];

		return {
			hasVideo: !!videoTrack,
			hasAudio: !!audioTrack,
			videoEnabled: videoTrack?.enabled || false,
			audioEnabled: audioTrack?.enabled || false,
			isScreenSharing: !!this.screenShareStream,
		};
	}

	setProducers({ videoProducer, audioProducer, screenProducer }) {
		if (videoProducer) {
			this.videoProducer = videoProducer;
		}
		if (audioProducer) {
			this.audioProducer = audioProducer;
		}
		if (screenProducer) {
			this.screenProducer = screenProducer;
		}
	}
}
