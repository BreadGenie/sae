// E2EE connection handshake — Vue composable wrapper.
//
// The state machine lives in E2EEHandshakeController; this composable
// wires Vue reactivity, DOM events, and Frappe Realtime events around it.
//
// The only consumer is useSFUConnection.ts.  Internal state refs that
// no caller reads are removed from the return type.

import { onUnmounted, type Ref } from "vue";
import { E2EEHandshakeController } from "../utils/media/E2EEHandshakeController";
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { CurrentUser } from "./useCurrentUser";
import { useDeviceIdentity } from "./useDeviceIdentity";
import { useE2EEHandshake } from "./useE2EEHandshake";
import type { MediaState } from "./useMediaState";

interface E2EEConnectionHandshakeDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
}

export interface E2EEConnectionHandshake {
	prepareJoiningHandshakeIfRequired: () => Promise<void>;
	handleMeetingE2EEEnabled: (data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_host_signing_public_key?: string;
		e2ee_key_version?: string;
	}) => Promise<void>;
	setupRealtimeEventListeners: () => void;
	teardownRealtimeEventListeners: () => void;
	teardownForDisconnect: () => void;
}

export function useE2EEConnectionHandshake(
	deps: E2EEConnectionHandshakeDeps,
): E2EEConnectionHandshake {
	const { meetingId, sfuClient, sfuManager, currentUser, mediaState } = deps;

	const { openJoinerEnvelope, buildHostEnvelope } = useE2EEHandshake();
	const { getIdentity: getDeviceIdentity } = useDeviceIdentity();

	const controller = new E2EEHandshakeController({
		meetingId,
		sfuClient,
		sfuManager,
		currentUser,
		mediaState,
		isCurrentTabHost: deps.isCurrentTabHost,
		getDeviceIdentity,
		openJoinerEnvelope,
		buildHostEnvelope,
	});

	controller.onHandshakeComplete = (detail) => {
		controller.setMeetingContext(
			detail.meetingSecret,
			detail.keyVersion,
			detail.signingPrivateKey,
		);
	};

	// ── pagehide ──────────────────────────────────────────────────────
	let pagehideHandlerAttached = false;
	const onPageHide = () => controller.teardownForDisconnect();

	// ── event routing ─────────────────────────────────────────────────
	let realtimeListenersAttached = false;

	const handleHandshakeMessageBound = (data: unknown) =>
		controller.handleHandshakeMessage(data);
	const handleSFUReconnectBound = () => controller.handleSFUReconnect();
	const handleHostE2EEKeySetBound = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (detail?.hostX25519KeyPair && detail?.keyVersion) {
			void controller.handleHostE2EEKeySet(detail);
		}
	};
	const handleHandshakeCompleteBound = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (!detail?.meetingSecret || detail?.keyVersion == null) return;
		if (detail.meetingId && detail.meetingId !== meetingId) return;
		void (async () => {
			const signingPrivateKey =
				detail.signingPrivateKey ??
				(await getDeviceIdentity()).signingKeyPair.privateKey;
			controller.setMeetingContext(
				detail.meetingSecret as Uint8Array<ArrayBuffer>,
				Number(detail.keyVersion),
				signingPrivateKey,
			);
		})();
	};
	const handleE2EEResyncBound = () => controller.resyncHandshake();

	function setupRealtimeEventListeners(): void {
		if (realtimeListenersAttached) return;
		sfuClient.on("e2ee:handshake", handleHandshakeMessageBound);
		sfuClient.on("reconnect", handleSFUReconnectBound);
		document.addEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySetBound,
		);
		document.addEventListener(
			"meet:e2ee-handshake-complete",
			handleHandshakeCompleteBound,
		);
		document.addEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResyncBound,
		);
		realtimeListenersAttached = true;
	}

	function teardownRealtimeEventListeners(): void {
		if (!realtimeListenersAttached) return;
		sfuClient.off("e2ee:handshake");
		sfuClient.off("reconnect");
		document.removeEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySetBound,
		);
		document.removeEventListener(
			"meet:e2ee-handshake-complete",
			handleHandshakeCompleteBound,
		);
		document.removeEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResyncBound,
		);
		realtimeListenersAttached = false;
	}

	if (typeof window !== "undefined") {
		window.addEventListener("pagehide", onPageHide);
		pagehideHandlerAttached = true;
	}

	onUnmounted(() => {
		teardownRealtimeEventListeners();
		if (pagehideHandlerAttached && typeof window !== "undefined") {
			window.removeEventListener("pagehide", onPageHide);
		}
	});

	const boundPrepareJoiningHandshakeIfRequired =
		controller.prepareJoiningHandshakeIfRequired.bind(controller);
	const boundHandleMeetingE2EEEnabled =
		controller.handleMeetingE2EEEnabled.bind(controller);
	const boundTeardownForDisconnect =
		controller.teardownForDisconnect.bind(controller);

	return {
		prepareJoiningHandshakeIfRequired: boundPrepareJoiningHandshakeIfRequired,
		handleMeetingE2EEEnabled: boundHandleMeetingE2EEEnabled,
		setupRealtimeEventListeners,
		teardownRealtimeEventListeners,
		teardownForDisconnect: boundTeardownForDisconnect,
	};
}
