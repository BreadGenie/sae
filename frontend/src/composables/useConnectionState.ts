import { type Ref, ref } from "vue";

export interface ConnectionState {
	isConnecting: Ref<boolean>;
	connectionError: Ref<string | null>;
	isInPreview: Ref<boolean>;
	isSetupComplete: Ref<boolean>;
	codecStrategy: Ref<string>;
	networkQuality: Ref<string>;
	connectionIssues: Ref<string[]>;
	guestId: Ref<string | null>;
	guestAuthToken: Ref<string | null>;
	guestSfuUrl: Ref<string | null>;
	guestSfuPort: Ref<string | null>;
	guestSessionToken: Ref<string | null>;
	resetConnectionState: () => void;
}

let instance: ConnectionState | null = null;

export function useConnectionState(): ConnectionState {
	if (instance) return instance;

	const isConnecting = ref(false);
	const connectionError = ref<string | null>(null);
	const isInPreview = ref(true);
	const isSetupComplete = ref(false);
	const codecStrategy = ref("svc");
	const networkQuality = ref("good");
	const connectionIssues = ref<string[]>([]);

	const guestId = ref<string | null>(null);
	const guestAuthToken = ref<string | null>(null);
	const guestSfuUrl = ref<string | null>(null);
	const guestSfuPort = ref<string | null>(null);
	const guestSessionToken = ref<string | null>(null);

	const resetConnectionState = () => {
		connectionError.value = null;
		isConnecting.value = false;
		isInPreview.value = true;
		isSetupComplete.value = false;
		codecStrategy.value = "svc";
		networkQuality.value = "good";
		connectionIssues.value = [];
		guestId.value = null;
		guestAuthToken.value = null;
		guestSfuUrl.value = null;
		guestSfuPort.value = null;
		guestSessionToken.value = null;
	};

	instance = {
		isConnecting,
		connectionError,
		isInPreview,
		isSetupComplete,
		codecStrategy,
		networkQuality,
		connectionIssues,
		guestId,
		guestAuthToken,
		guestSfuUrl,
		guestSfuPort,
		guestSessionToken,
		resetConnectionState,
	};

	return instance;
}
