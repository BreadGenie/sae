import { type Ref, ref } from "vue";

export interface ScreenShareConsumer {
	participantId: string;
	consumerId: string;
	startedAt: number;
	local?: boolean;
}

export interface MediaState {
	isMicOn: Ref<boolean>;
	isCameraOn: Ref<boolean>;
	isScreenSharing: Ref<boolean>;
	localStream: Ref<MediaStream | null>;
	processedStream: Ref<MediaStream | null>;
	cameraPermissionGranted: Ref<boolean>;
	microphonePermissionGranted: Ref<boolean>;
	screenShareStream: Ref<MediaStream | null>;
	localScreenShareStartedAt: Ref<number>;
	activeScreenShareConsumers: Ref<ScreenShareConsumer[]>;
	screenShareStreams: Ref<Record<string, MediaStream>>;
	localVideo: Ref<HTMLElement | null>;
	setMediaState: (mic: boolean, camera: boolean) => void;
	resetMediaState: () => void;
}

let instance: MediaState | null = null;

export function useMediaState(): MediaState {
	if (instance) {
		if (!instance.cameraPermissionGranted) {
			instance.cameraPermissionGranted = ref(false);
		}
		if (!instance.microphonePermissionGranted) {
			instance.microphonePermissionGranted = ref(false);
		}
		return instance;
	}

	const isMicOn = ref(false);
	const isCameraOn = ref(false);
	const isScreenSharing = ref(false);
	const localStream = ref<MediaStream | null>(null);
	const processedStream = ref<MediaStream | null>(null);
	const cameraPermissionGranted = ref(false);
	const microphonePermissionGranted = ref(false);
	const screenShareStream = ref<MediaStream | null>(null);
	const localScreenShareStartedAt = ref(0);
	const activeScreenShareConsumers = ref<ScreenShareConsumer[]>([]);
	const screenShareStreams = ref<Record<string, MediaStream>>({});
	const localVideo = ref<HTMLElement | null>(null);

	const setMediaState = (mic: boolean, camera: boolean) => {
		isMicOn.value = mic;
		isCameraOn.value = camera;
	};

	const resetMediaState = () => {
		isMicOn.value = false;
		isCameraOn.value = false;
		isScreenSharing.value = false;
		localStream.value = null;
		processedStream.value = null;
		cameraPermissionGranted.value = false;
		microphonePermissionGranted.value = false;
		screenShareStream.value = null;
		localScreenShareStartedAt.value = 0;
		activeScreenShareConsumers.value = [];
		screenShareStreams.value = {};
		localVideo.value = null;
	};

	instance = {
		isMicOn,
		isCameraOn,
		isScreenSharing,
		localStream,
		processedStream,
		cameraPermissionGranted,
		microphonePermissionGranted,
		screenShareStream,
		localScreenShareStartedAt,
		activeScreenShareConsumers,
		screenShareStreams,
		localVideo,
		setMediaState,
		resetMediaState,
	};

	return instance;
}
