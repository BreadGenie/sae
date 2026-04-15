export const STUB_MEDIA_SCRIPT = `(() => {
	window.localStorage.setItem("mediaPref.autoHideToolbar", "0");

	if (!navigator.mediaDevices) {
		Object.defineProperty(navigator, "mediaDevices", {
			value: {},
			configurable: true,
		});
	}

	function createFakeStream(label) {
		const canvas = document.createElement("canvas");
		canvas.width = 1280;
		canvas.height = 720;
		const context = canvas.getContext("2d");
		let tick = 0;

		const draw = () => {
			if (!context) {
				return;
			}
			context.fillStyle = "#111827";
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = "#f9fafb";
			context.font = "32px sans-serif";
			context.fillText(label, 48, 80);
			context.font = "20px monospace";
			context.fillText(String(++tick), 48, 128);
			requestAnimationFrame(draw);
		};

		draw();

		const stream = canvas.captureStream(12);

		try {
			const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
			if (AudioContextCtor) {
				const audioContext = new AudioContextCtor();
				const oscillator = audioContext.createOscillator();
				const gainNode = audioContext.createGain();
				const destination = audioContext.createMediaStreamDestination();
				gainNode.gain.value = 0.001;
				oscillator.connect(gainNode);
				gainNode.connect(destination);
				oscillator.start();
				for (const track of destination.stream.getAudioTracks()) {
					stream.addTrack(track);
				}
			}
		} catch {}

		return stream;
	}

	const userStream = createFakeStream("camera");
	const displayStream = createFakeStream("screen");

	navigator.mediaDevices.getUserMedia = async () => userStream.clone();
	navigator.mediaDevices.getDisplayMedia = async () => displayStream.clone();
})();`;
