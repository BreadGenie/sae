// E2EE connection handshake state machine.
//
// The host runs a fresh ECDH with every joiner to deliver the meeting
// secret (per-joiner envelope). The SFU is a relay only — it never sees
// the envelope contents.
//
// Under threat model B, the envelope is *signed* by the host's server-
// published Ed25519 signing key. A self-supplied key is not a trust
// anchor. See docs/refactors/e2ee-modernization.md for the full protocol.

import { toast } from "frappe-ui";
import { onUnmounted, type Ref, shallowRef } from "vue";
import { E2EEMeeting } from "../utils/media/E2EEMeeting";
import {
	exportEd25519PublicKey,
	exportPublicKey,
	importEd25519PublicKey,
	x25519KeyPair,
} from "../utils/media/e2ee";
import { bufferToBase64, bytesFromBase64 } from "../utils/media/e2eePrimitives";
import type { SFUClient } from "../utils/SFUClient";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import type { CurrentUser } from "./useCurrentUser";
import { useDeviceIdentity } from "./useDeviceIdentity";
import { useE2EEHandshake } from "./useE2EEHandshake";
import type { MediaState } from "./useMediaState";

const E2EE_KEY_HOLDER_TIMEOUT_MESSAGE =
	"The meeting host is not online to provide the E2EE key. Ask the host to stay online, or recreate the meeting.";

interface JoinerHello {
	fromParticipantId: string;
	fromSenderId: number;
	x25519PublicKey: string;
	signingPublicKey: string;
}

interface HandshakeMessage {
	fromParticipantId?: string;
	fromSenderId?: number;
	toParticipantId?: string;
	toSenderId?: number;
	x25519PublicKey?: string;
	signingPublicKey?: string;
	envelope?: string;
	hostX25519PublicKey?: string;
	hostSigningPublicKey?: string;
}

interface E2EEConnectionHandshakeDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
}

export interface E2EEConnectionHandshake {
	meetingSecret: Ref<Uint8Array<ArrayBuffer> | null>;
	keyVersion: Ref<number | null>;
	joinerX25519PrivateKey: Ref<CryptoKey | null>;
	joinerX25519PublicKeyBase64: Ref<string | null>;
	hostX25519PrivateKey: Ref<CryptoKey | null>;
	hostX25519PublicKeyBase64: Ref<string | null>;
	hostSigningPrivateKey: Ref<CryptoKey | null>;
	hostSigningPublicKey: Ref<CryptoKey | null>;
	identitySigningPublicKeyBase64: Ref<string>;
	joinerPublicKeyBySenderId: Map<number, string>;
	joinerSigningPublicKeyBySenderId: Map<number, string>;
	isReconfiguringForE2EE: () => boolean;
	prepareJoiningHandshakeIfRequired: () => Promise<void>;
	startHandshakeAsJoiner: (
		hostX25519PublicKeyBase64: string,
		hostSigningPublicKeyBase64: string,
		keyVersionString: string,
	) => Promise<void>;
	setupRealtimeEventListeners: () => void;
	teardownRealtimeEventListeners: () => void;
	teardownForDisconnect: () => void;
	handleMeetingE2EEEnabled: (data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_host_signing_public_key?: string;
		e2ee_key_version?: string;
	}) => Promise<void>;
}

export function useE2EEConnectionHandshake(
	deps: E2EEConnectionHandshakeDeps,
): E2EEConnectionHandshake {
	const { meetingId, sfuClient, sfuManager, currentUser, mediaState } = deps;

	const { openJoinerEnvelope, buildHostEnvelope } = useE2EEHandshake();
	const { getIdentity: getDeviceIdentity } = useDeviceIdentity();

	const hostX25519PrivateKey = shallowRef<CryptoKey | null>(null);
	const hostX25519PublicKeyBase64 = shallowRef<string | null>(null);
	const hostSigningPrivateKey = shallowRef<CryptoKey | null>(null);
	const hostSigningPublicKey = shallowRef<CryptoKey | null>(null);
	const identitySigningPublicKeyBase64 = shallowRef<string>("");
	const joinerX25519PrivateKey = shallowRef<CryptoKey | null>(null);
	const joinerX25519PublicKeyBase64 = shallowRef<string | null>(null);
	const joinerPublicKeyBySenderId = new Map<number, string>();
	const joinerSigningPublicKeyBySenderId = new Map<number, string>();
	const meetingSecret = shallowRef<Uint8Array<ArrayBuffer> | null>(null);
	const keyVersion = shallowRef<number | null>(null);
	const pendingJoinerHellos: JoinerHello[] = [];
	let isReconfiguringForE2EE = false;
	let realtimeListenersAttached = false;
	const onPageHide = () => {
		meetingSecret.value?.fill(0);
		meetingSecret.value = null;
		joinerX25519PrivateKey.value = null;
		joinerX25519PublicKeyBase64.value = null;
		hostX25519PrivateKey.value = null;
		hostX25519PublicKeyBase64.value = null;
		joinerPublicKeyBySenderId.clear();
		keyVersion.value = null;
		E2EEMeeting.instance.wipeMeetingContext();
	};
	let pagehideHandlerAttached = false;

	const parseKeyVersion = (_s: string): number => 1;

	const wipeE2EERuntimeState = () => {
		meetingSecret.value?.fill(0);
		meetingSecret.value = null;
		joinerX25519PrivateKey.value = null;
		joinerX25519PublicKeyBase64.value = null;
		hostSigningPublicKey.value = null;
		joinerPublicKeyBySenderId.clear();
		joinerSigningPublicKeyBySenderId.clear();
		keyVersion.value = null;
		E2EEMeeting.instance.wipeMeetingContext();
	};

	const ownParticipantId = (): string =>
		currentUser.currentUser.value?.user_id ?? "";

	const flushPendingJoinerHellos = () => {
		if (!meetingSecret.value || keyVersion.value == null) return;
		const selfId = ownParticipantId();
		const pending = pendingJoinerHellos.splice(0);
		for (const hello of pending) {
			if (hello.fromParticipantId === selfId) continue;
			void handleJoinerHello(hello);
		}
	};

	const announceSigningKey = async () => {
		if (!joinerX25519PrivateKey.value || !joinerX25519PublicKeyBase64.value) {
			const kp = await x25519KeyPair();
			joinerX25519PrivateKey.value = kp.privateKey;
			joinerX25519PublicKeyBase64.value = await exportPublicKey(kp.publicKey);
		}
		const senderId = sfuClient.getOwnSenderId?.() ?? 0;
		const identity = await getDeviceIdentity();
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: ownParticipantId(),
			fromSenderId: senderId,
			x25519PublicKey: joinerX25519PublicKeyBase64.value,
			signingPublicKey: identity.signingPublicKey,
		});
	};

	const startHandshakeAsJoiner = async (
		hostX25519PublicKeyBase64Param: string,
		hostSigningPublicKeyBase64: string,
		keyVersionString: string,
	) => {
		const kp = await x25519KeyPair();
		joinerX25519PrivateKey.value = kp.privateKey;
		joinerX25519PublicKeyBase64.value = await exportPublicKey(kp.publicKey);
		keyVersion.value = parseKeyVersion(keyVersionString);
		hostX25519PublicKeyBase64.value = hostX25519PublicKeyBase64Param;
		hostSigningPublicKey.value = hostSigningPublicKeyBase64
			? await importEd25519PublicKey(hostSigningPublicKeyBase64)
			: null;
		await announceSigningKey();
	};

	const handleHandshakeEnvelope = async (data: HandshakeMessage) => {
		if (!data.envelope) {
			return;
		}
		const envelopeHostX25519PublicKey =
			data.hostX25519PublicKey || hostX25519PublicKeyBase64.value;
		if (
			!joinerX25519PrivateKey.value ||
			!envelopeHostX25519PublicKey ||
			!hostX25519PublicKeyBase64.value ||
			envelopeHostX25519PublicKey !== hostX25519PublicKeyBase64.value ||
			keyVersion.value == null
		) {
			return;
		}
		if (data.toParticipantId && data.toParticipantId !== ownParticipantId()) {
			return;
		}
		if (!hostSigningPublicKey.value) {
			return;
		}
		const kp: CryptoKeyPair = {
			privateKey: joinerX25519PrivateKey.value,
			publicKey: null as unknown as CryptoKey,
		};
		let result: {
			meetingSecret: Uint8Array<ArrayBuffer>;
			hostSigningPublicKey: Uint8Array<ArrayBuffer>;
		};
		try {
			result = await openJoinerEnvelope(
				kp,
				envelopeHostX25519PublicKey,
				hostSigningPublicKey.value,
				data.envelope,
				{ meetingId, keyVersion: keyVersion.value },
			);
		} catch (err) {
			console.error("[E2EE] openJoinerEnvelope failed:", err);
			return;
		}
		const envelopeSenderId = data.fromSenderId;
		try {
			const pub = await importEd25519PublicKey(
				bufferToBase64(result.hostSigningPublicKey),
			);
			E2EEMeeting.instance.setSenderSigningPub(envelopeSenderId, pub);
		} catch (err) {
			console.error("[E2EE] failed to import host signing public key:", err);
			return;
		}
		meetingSecret.value = result.meetingSecret;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: result.meetingSecret,
					keyVersion: keyVersion.value,
					signingPrivateKey: (await getDeviceIdentity()).signingKeyPair
						.privateKey,
				},
			}),
		);
	};

	const handleJoinerHello = async (data: JoinerHello) => {
		if (data.fromParticipantId === ownParticipantId()) {
			return;
		}
		if (!data.x25519PublicKey || !data.signingPublicKey) {
			return;
		}
		joinerPublicKeyBySenderId.set(data.fromSenderId, data.x25519PublicKey);
		joinerSigningPublicKeyBySenderId.set(
			data.fromSenderId,
			data.signingPublicKey,
		);
		try {
			E2EEMeeting.instance.setSenderSigningPub(
				data.fromSenderId,
				await importEd25519PublicKey(data.signingPublicKey),
			);
		} catch (err) {
			console.error("[E2EE] failed to import joiner signing pub:", err);
			return;
		}
		if (!meetingSecret.value || keyVersion.value == null) {
			pendingJoinerHellos.push({
				fromParticipantId: data.fromParticipantId,
				fromSenderId: data.fromSenderId,
				x25519PublicKey: data.x25519PublicKey,
				signingPublicKey: data.signingPublicKey,
			});
			return;
		}
		if (!hostX25519PrivateKey.value) {
			return;
		}

		const identity = await getDeviceIdentity();
		const hostSigningPriv = identity.signingKeyPair.privateKey;
		if (!identitySigningPublicKeyBase64.value) {
			identitySigningPublicKeyBase64.value = identity.signingPublicKey;
		}
		if (!identitySigningPublicKeyBase64.value) {
			console.warn("[E2EE] handleJoinerHello: host signing key missing");
			return;
		}

		const hostX25519Priv = hostX25519PrivateKey.value;
		const hostX25519PubB64 = hostX25519PublicKeyBase64.value ?? "";
		if (!hostX25519PubB64) {
			console.log(
				"[E2EE] handleJoinerHello: host priv exists but pub not exported yet, returning",
			);
			return;
		}
		const hostX25519PublicKeyBytes = bytesFromBase64(hostX25519PubB64);
		const hostSigningPublicKeyBytes = bytesFromBase64(
			identitySigningPublicKeyBase64.value,
		);

		const envelope = await buildHostEnvelope(
			hostX25519Priv,
			hostSigningPriv,
			data.x25519PublicKey,
			hostX25519PublicKeyBytes,
			hostSigningPublicKeyBytes,
			meetingSecret.value,
			{ meetingId, keyVersion: keyVersion.value },
		);
		const ownSenderId = sfuClient.getOwnSenderId?.() ?? 0;
		sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: ownParticipantId(),
			fromSenderId: ownSenderId,
			toParticipantId: data.fromParticipantId,
			toSenderId: data.fromSenderId,
			envelope,
			hostX25519PublicKey: hostX25519PubB64,
			hostSigningPublicKey: identitySigningPublicKeyBase64.value,
		});
	};

	const handleHandshakeMessage = (data: unknown) => {
		if (!data || typeof data !== "object") {
			return;
		}
		const msg = data as HandshakeMessage;
		if (msg.envelope) {
			void handleHandshakeEnvelope(msg);
		} else if (msg.x25519PublicKey) {
			void handleJoinerHello({
				fromParticipantId: msg.fromParticipantId ?? "",
				fromSenderId: msg.fromSenderId ?? 0,
				x25519PublicKey: msg.x25519PublicKey,
				signingPublicKey: msg.signingPublicKey ?? "",
			});
		}
	};

	const generateHostMeetingSecret = async () => {
		const ms = new Uint8Array(32);
		globalThis.crypto.getRandomValues(ms);
		meetingSecret.value = ms;
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-handshake-complete", {
				detail: {
					meetingId,
					meetingSecret: ms,
					keyVersion: keyVersion.value,
					signingPrivateKey: (await getDeviceIdentity()).signingKeyPair
						.privateKey,
				},
			}),
		);
		flushPendingJoinerHellos();
	};

	const waitForHandshakeComplete = (timeoutMs: number): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (meetingSecret.value) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				reject(new Error("E2EE handshake timed out"));
			}, timeoutMs);
			const listener = () => {
				if (meetingSecret.value) {
					clearTimeout(timer);
					document.removeEventListener(
						"meet:e2ee-handshake-complete",
						listener,
					);
					resolve();
				}
			};
			document.addEventListener("meet:e2ee-handshake-complete", listener);
		});
	};

	const handleHostE2EEKeySet = async (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (detail?.hostX25519KeyPair && detail?.keyVersion) {
			hostX25519PrivateKey.value = detail.hostX25519KeyPair.privateKey;
			hostX25519PublicKeyBase64.value = null;
			keyVersion.value = parseKeyVersion(detail.keyVersion);

			const pubB64 = await exportPublicKey(detail.hostX25519KeyPair.publicKey);
			hostX25519PublicKeyBase64.value = pubB64;
			if (detail?.hostSigningKeyPair) {
				hostSigningPrivateKey.value = detail.hostSigningKeyPair.privateKey;
				identitySigningPublicKeyBase64.value = await exportEd25519PublicKey(
					detail.hostSigningKeyPair.publicKey,
				);
			}
			if (sfuClient) {
				sfuClient.setE2EERequired(true, {
					hostPublicKey: pubB64,
					hostSigningPublicKey: identitySigningPublicKeyBase64.value ?? null,
					keyVersion: detail.keyVersion,
				});
			}

			await generateHostMeetingSecret();

			// The host's existing producers were created on a non-E2EE
			// transport. We must tear them down and re-create on a new
			// E2EE-enabled transport so the sender transforms are installed.
			if (isReconfiguringForE2EE) return;
			isReconfiguringForE2EE = true;

			try {
				if (!sfuClient?.isConnected?.()) return;

				const videoStreamForRepublish =
					mediaState.processedStream || mediaState.localStream;
				const audioStreamForRepublish = mediaState.localStream;

				await sfuClient.refreshToken();

				// refreshToken() reflects the server's last persisted E2EE state,
				// which can still be stale while the host is converting the
				// meeting mid-call. Re-assert the host's freshly-generated
				// state before re-joining so transport setup installs transforms.
				sfuClient.setE2EERequired(true, {
					hostPublicKey: pubB64,
					hostSigningPublicKey: identitySigningPublicKeyBase64.value ?? null,
					keyVersion: detail.keyVersion,
				});

				const userData = {
					userId: currentUser.currentUser.value?.user_id || "",
					name:
						currentUser.currentUser.value?.full_name ||
						currentUser.currentUser.value?.name ||
						"",
					avatar: currentUser.currentUser.value?.avatar || null,
					is_guest: currentUser.currentUser.value?.is_guest || false,
				};
				await sfuClient.joinRoom(meetingId, userData, {
					audio_enabled: mediaState.isMicOn,
					video_enabled: mediaState.isCameraOn,
				});

				if (sfuManager.value) {
					await sfuManager.value.reconfigureForE2EE(
						videoStreamForRepublish,
						audioStreamForRepublish,
					);
				}
			} catch (error) {
				console.error("Failed to reconfigure host for E2EE:", error);
			} finally {
				isReconfiguringForE2EE = false;
			}
		}
	};

	const handleHandshakeComplete = (event: Event) => {
		const detail = (event as CustomEvent).detail;
		if (!detail?.meetingSecret || detail?.keyVersion == null) {
			return;
		}
		if (detail.meetingId && detail.meetingId !== meetingId) {
			return;
		}
		void (async () => {
			const signingPrivateKey =
				detail.signingPrivateKey ??
				(await getDeviceIdentity()).signingKeyPair.privateKey;
			E2EEMeeting.instance.setMeetingContext(
				detail.meetingSecret as Uint8Array<ArrayBuffer>,
				Number(detail.keyVersion),
				signingPrivateKey,
			);
			flushPendingJoinerHellos();
		})();
	};

	const resyncHandshake = () => {
		wipeE2EERuntimeState();
		if (!hostX25519PublicKeyBase64.value) return;
		if (!sfuManager.value || !sfuClient.connected) return;
		const hostSigningPubB64 =
			sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
		if (!hostSigningPubB64) return;
		void startHandshakeAsJoiner(
			hostX25519PublicKeyBase64.value,
			hostSigningPubB64,
			sfuClient.connectionDetails.e2eeKeyVersion ?? "",
		);
	};

	const handleSFUReconnect = () => {
		if (deps.isCurrentTabHost.value) return;
		if (!meetingSecret.value) return;
		resyncHandshake();
	};

	const handleE2EEResync = (event: Event) => {
		const detail = (
			event as CustomEvent<{
				senderId: number;
				generation: number;
			}>
		).detail;
		console.warn(
			`E2EE: resync requested for sender ${detail.senderId} (gen ${detail.generation})`,
		);
		resyncHandshake();
	};

	const handleMeetingE2EEEnabled = async (data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_host_signing_public_key?: string;
		e2ee_key_version?: string;
	}) => {
		if (data.meeting_id !== meetingId) return;
		if (deps.isCurrentTabHost.value) return;
		if (isReconfiguringForE2EE) return;

		// path: if the realtime payload carries the host's X25519 pubkey
		// and a key version, start the handshake. We MUST wait for it
		// to complete (meeting_secret received) before reconfiguring media,
		// otherwise we publish encrypted frames with no decryption key.
		if (data.e2ee_host_public_key && data.e2ee_key_version) {
			const hostSigningPubB64 = data.e2ee_host_signing_public_key ?? "";
			if (!hostSigningPubB64) {
				console.error(
					"[E2EE] meeting:e2ee_enabled missing host signing pubkey",
				);
				return;
			}
			try {
				await startHandshakeAsJoiner(
					data.e2ee_host_public_key,
					hostSigningPubB64,
					data.e2ee_key_version,
				);
				// Wait for the handshake to complete (envelope received and
				// decrypted). The handleHandshakeComplete listener fires
				// meet:e2ee-handshake-complete which calls setMeetingContext.
				await waitForHandshakeComplete(10000);
			} catch (err) {
				console.error("E2EE handshake (joiner) failed:", err);
				toast.error(E2EE_KEY_HOLDER_TIMEOUT_MESSAGE);
				return;
			}
		}

		// Update SFU client's view of the meeting's E2EE state from the
		// realtime payload. Without this, the re-joinRoom call below would
		// send e2ee.enabled=false because connectionDetails was populated
		// before the host enabled E2EE, and the SFU would reject the
		// join with "E2EE is required for this room".
		sfuClient?.setE2EERequired(Boolean(data.e2ee_host_public_key), {
			hostPublicKey: data.e2ee_host_public_key ?? null,
			hostSigningPublicKey: data.e2ee_host_signing_public_key ?? null,
			keyVersion: data.e2ee_key_version ?? null,
		});

		isReconfiguringForE2EE = true;

		try {
			if (!sfuClient?.isConnected?.()) return;

			const hadCamera = mediaState.isCameraOn;
			const hadMic = mediaState.isMicOn;

			// Keep the live streams around so reconfigureForE2EE can re-produce
			// their tracks on the new E2EE-enabled send transport in the same
			// call. Stopping the tracks here and re-acquiring later races with
			// the SFU producer_created/producer_closed events and leaves the
			// host with no producers attached to the encrypted transport.
			//
			// The video stream should be the processed (background-effects-
			// applied) one so remote participants keep seeing the host with
			// the same background effects that were applied before E2EE.
			// The audio stream must be the raw local stream — the processed
			// stream only contains the BG-rendered video track and has no
			// audio.
			const videoStreamForRepublish =
				mediaState.processedStream || mediaState.localStream;
			const audioStreamForRepublish = mediaState.localStream;

			await sfuClient.refreshToken();

			const userData = {
				userId: currentUser.currentUser.value?.user_id || "",
				name:
					currentUser.currentUser.value?.full_name ||
					currentUser.currentUser.value?.name ||
					"",
				avatar: currentUser.currentUser.value?.avatar || null,
				is_guest: currentUser.currentUser.value?.is_guest || false,
			};
			await sfuClient.joinRoom(meetingId, userData, {
				audio_enabled: mediaState.isMicOn,
				video_enabled: mediaState.isCameraOn,
			});

			if (sfuManager.value) {
				await sfuManager.value.reconfigureForE2EE(
					videoStreamForRepublish,
					audioStreamForRepublish,
				);
			}

			// Only request a fresh stream if we didn't have one to republish.
			if (!videoStreamForRepublish || !audioStreamForRepublish) {
				document.dispatchEvent(
					new CustomEvent("meet:e2ee-needs-media-republish", {
						detail: { hadCamera, hadMic },
					}),
				);
			}
		} catch (error) {
			console.error("Failed to reconfigure for E2EE:", error);
		} finally {
			isReconfiguringForE2EE = false;
		}
	};

	const prepareJoiningHandshakeIfRequired = async () => {
		if (!sfuClient.isE2EERequired() || meetingSecret.value) {
			return;
		}
		const identity = await getDeviceIdentity();
		identitySigningPublicKeyBase64.value = identity.signingPublicKey;

		const hostPublicKeyBase64 = sfuClient.connectionDetails.e2eeHostPublicKey;
		const hostSigningPubB64 =
			sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
		const hostUserId = sfuClient.connectionDetails.e2eeHostUserId;
		const versionString = sfuClient.connectionDetails.e2eeKeyVersion ?? "";
		if (hostPublicKeyBase64 && (hostSigningPubB64 || hostUserId)) {
			void startHandshakeAsJoiner(
				hostPublicKeyBase64,
				hostSigningPubB64,
				versionString,
			);
			try {
				await waitForHandshakeComplete(10000);
			} catch (error) {
				throw new Error(E2EE_KEY_HOLDER_TIMEOUT_MESSAGE, {
					cause: error,
				});
			}
		} else {
			throw new Error("E2EE is required but host key metadata is missing");
		}
	};

	const setupRealtimeEventListeners = () => {
		if (realtimeListenersAttached) return;
		sfuClient.on("e2ee:handshake", handleHandshakeMessage);
		sfuClient.on("reconnect", handleSFUReconnect);
		document.addEventListener("meet:e2ee-host-enabled", handleHostE2EEKeySet);
		document.addEventListener(
			"meet:e2ee-handshake-complete",
			handleHandshakeComplete,
		);
		document.addEventListener("meet:e2ee-needs-key-resync", handleE2EEResync);
		realtimeListenersAttached = true;
	};

	const teardownRealtimeEventListeners = () => {
		if (!realtimeListenersAttached) return;
		sfuClient.off("e2ee:handshake");
		sfuClient.off("reconnect");
		document.removeEventListener(
			"meet:e2ee-host-enabled",
			handleHostE2EEKeySet,
		);
		document.removeEventListener(
			"meet:e2ee-handshake-complete",
			handleHandshakeComplete,
		);
		document.removeEventListener(
			"meet:e2ee-needs-key-resync",
			handleE2EEResync,
		);
		realtimeListenersAttached = false;
	};

	const teardownForDisconnect = () => {
		meetingSecret.value?.fill(0);
		meetingSecret.value = null;
		joinerX25519PrivateKey.value = null;
		joinerX25519PublicKeyBase64.value = null;
		hostX25519PrivateKey.value = null;
		hostX25519PublicKeyBase64.value = null;
		joinerPublicKeyBySenderId.clear();
		keyVersion.value = null;
		E2EEMeeting.instance.wipeMeetingContext();
	};

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

	return {
		meetingSecret,
		keyVersion,
		joinerX25519PrivateKey,
		joinerX25519PublicKeyBase64,
		hostX25519PrivateKey,
		hostX25519PublicKeyBase64,
		hostSigningPrivateKey,
		hostSigningPublicKey,
		identitySigningPublicKeyBase64,
		joinerPublicKeyBySenderId,
		joinerSigningPublicKeyBySenderId,
		isReconfiguringForE2EE: () => isReconfiguringForE2EE,
		prepareJoiningHandshakeIfRequired,
		startHandshakeAsJoiner,
		setupRealtimeEventListeners,
		teardownRealtimeEventListeners,
		teardownForDisconnect,
		handleMeetingE2EEEnabled,
	};
}
