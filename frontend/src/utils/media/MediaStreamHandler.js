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
	}

	async getUserMedia(constraints = { video: true, audio: true }) {
		try {
			console.log("🎥 Requesting user media with constraints:", constraints);
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			this.localStream = stream;
			return stream;
		} catch (error) {
			console.error("❌ Failed to get user media:", error);
			throw error;
		}
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
				await this.videoProducer.replaceTrack({ track: newVideoTrack });
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

		console.log("🧹 Media streams cleaned up");
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
