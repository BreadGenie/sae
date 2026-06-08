// E2EE handshake state machine.
//
// Intent-driven controller that owns all handshake state (meeting secret,
// key version, X25519 key pairs, joiner public-key maps, pending-hello
// queue) and exposes methods that represent protocol intents:
//
//   host   → generateHostMeetingSecret()
//   joiner → startHandshakeAsJoiner()
//   either → handleJoinerHello(), handleHandshakeEnvelope()
//   either → teardownForDisconnect(), wipeRuntimeState()
//
// This controller is *event-bus-agnostic*: it does not listen to or emit
// DOM events, Frappe Realtime messages, or Vue lifecycle hooks.  The Vue
// composable in useE2EEConnectionHandshake.ts wires the controller to
// those channels.

import { toast } from "frappe-ui";
import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { MediaState } from "../../composables/useMediaState";
import type { SFUClient } from "../SFUClient";
import type { SFUMeetingManager } from "../SFUMeetingManager";
import { E2EEMeeting } from "./E2EEMeeting";
import {
	exportEd25519PublicKey,
	exportPublicKey,
	importEd25519PublicKey,
	x25519KeyPair,
} from "./e2ee";
import { bufferToBase64, bytesFromBase64 } from "./e2eePrimitives";

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

interface E2EEHandshakeControllerDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
	getDeviceIdentity: () => Promise<{
		signingPublicKey: string;
		signingKeyPair: CryptoKeyPair;
	}>;
	openJoinerEnvelope: (
		joinKeyPair: CryptoKeyPair,
		hostX25519PublicKeyBase64: string,
		hostSigningPublicKey: CryptoKey,
		envelope: string,
		context: { meetingId: string; keyVersion: number },
	) => Promise<{
		meetingSecret: Uint8Array<ArrayBuffer>;
		hostSigningPublicKey: Uint8Array<ArrayBuffer>;
	}>;
	buildHostEnvelope: (
		hostX25519PrivateKey: CryptoKey,
		hostSigningPrivateKey: CryptoKey,
		joinerX25519PublicKeyBase64: string,
		hostX25519PublicKey: Uint8Array<ArrayBuffer>,
		hostSigningPublicKey: Uint8Array<ArrayBuffer>,
		meetingSecret: Uint8Array<ArrayBuffer>,
		context: { meetingId: string; keyVersion: number },
	) => Promise<string>;
}

export class E2EEHandshakeController {
	private readonly deps: E2EEHandshakeControllerDeps;

	// -- state --
	meetingSecret: Uint8Array<ArrayBuffer> | null = null;
	keyVersion: number | null = null;
	joinerX25519PrivateKey: CryptoKey | null = null;
	joinerX25519PublicKeyBase64: string | null = null;
	hostX25519PrivateKey: CryptoKey | null = null;
	hostX25519PublicKeyBase64: string | null = null;
	hostSigningPrivateKey: CryptoKey | null = null;
	hostSigningPublicKey: CryptoKey | null = null;
	identitySigningPublicKeyBase64 = "";
	readonly joinerPublicKeyBySenderId = new Map<number, string>();
	readonly joinerSigningPublicKeyBySenderId = new Map<number, string>();
	private readonly pendingJoinerHellos: JoinerHello[] = [];
	isReconfiguringForE2EE = false;

	// -- callbacks --
	onHandshakeComplete:
		| ((detail: {
				meetingId: string;
				meetingSecret: Uint8Array<ArrayBuffer>;
				keyVersion: number;
				signingPrivateKey: CryptoKey;
		  }) => void)
		| null = null;

	constructor(deps: E2EEHandshakeControllerDeps) {
		this.deps = deps;
	}

	// ── helpers ──────────────────────────────────────────────────────────

	parseKeyVersion(_s: string): number {
		// TODO(Layer 3 epoch ADR): parse real key-version string when epochs
		// are introduced.  For v1 every meeting secret has version 1.
		return 1;
	}

	private get meetingId(): string {
		return this.deps.meetingId;
	}

	private get sfuClient(): SFUClient {
		return this.deps.sfuClient;
	}

	private get sfuManager(): Ref<SFUMeetingManager | null> {
		return this.deps.sfuManager;
	}

	private get currentUser(): CurrentUser {
		return this.deps.currentUser;
	}

	private get mediaState(): MediaState {
		return this.deps.mediaState;
	}

	private get isCurrentTabHost(): Ref<boolean> {
		return this.deps.isCurrentTabHost;
	}

	private get getDeviceIdentity(): () => Promise<{
		signingPublicKey: string;
		signingKeyPair: CryptoKeyPair;
	}> {
		return this.deps.getDeviceIdentity;
	}

	private get openJoinerEnvelope(): E2EEHandshakeControllerDeps["openJoinerEnvelope"] {
		return this.deps.openJoinerEnvelope;
	}

	private get buildHostEnvelope(): E2EEHandshakeControllerDeps["buildHostEnvelope"] {
		return this.deps.buildHostEnvelope;
	}

	private ownParticipantId(): string {
		return this.currentUser.currentUser.value?.user_id ?? "";
	}

	private async announceSigningKey(): Promise<void> {
		if (!this.joinerX25519PrivateKey || !this.joinerX25519PublicKeyBase64) {
			const kp = await x25519KeyPair();
			this.joinerX25519PrivateKey = kp.privateKey;
			this.joinerX25519PublicKeyBase64 = await exportPublicKey(kp.publicKey);
		}
		const senderId = this.sfuClient.getOwnSenderId?.() ?? 0;
		const identity = await this.getDeviceIdentity();
		this.sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: this.ownParticipantId(),
			fromSenderId: senderId,
			x25519PublicKey: this.joinerX25519PublicKeyBase64,
			signingPublicKey: identity.signingPublicKey,
		});
	}

	private async reconfigureMediaForE2EE(): Promise<void> {
		if (!this.sfuClient?.isConnected?.()) return;

		const hadCamera = this.mediaState.isCameraOn;
		const hadMic = this.mediaState.isMicOn;

		const videoStreamForRepublish =
			this.mediaState.processedStream || this.mediaState.localStream;
		const audioStreamForRepublish = this.mediaState.localStream;

		await this.sfuClient.refreshToken();

		const userData = {
			userId: this.currentUser.currentUser.value?.user_id || "",
			name:
				this.currentUser.currentUser.value?.full_name ||
				this.currentUser.currentUser.value?.name ||
				"",
			avatar: this.currentUser.currentUser.value?.avatar || null,
			is_guest: this.currentUser.currentUser.value?.is_guest || false,
		};
		await this.sfuClient.joinRoom(this.meetingId, userData, {
			audio_enabled: this.mediaState.isMicOn,
			video_enabled: this.mediaState.isCameraOn,
		});

		if (this.sfuManager.value) {
			await this.sfuManager.value.reconfigureForE2EE(
				videoStreamForRepublish,
				audioStreamForRepublish,
			);
		}

		if (!videoStreamForRepublish || !audioStreamForRepublish) {
			document.dispatchEvent(
				new CustomEvent("meet:e2ee-needs-media-republish", {
					detail: { hadCamera, hadMic },
				}),
			);
		}
	}

	private dispatchHandshakeComplete(
		meetingSecret: Uint8Array<ArrayBuffer>,
		signingPrivateKey: CryptoKey,
	): void {
		if (this.keyVersion == null) return;
		this.onHandshakeComplete?.({
			meetingId: this.meetingId,
			meetingSecret,
			keyVersion: this.keyVersion,
			signingPrivateKey,
		});
	}

	// ── intent: wipe ────────────────────────────────────────────────────

	wipeRuntimeState(): void {
		this.meetingSecret?.fill(0);
		this.meetingSecret = null;
		this.joinerX25519PrivateKey = null;
		this.joinerX25519PublicKeyBase64 = null;
		this.hostSigningPublicKey = null;
		this.hostX25519PrivateKey = null;
		this.hostX25519PublicKeyBase64 = null;
		this.hostSigningPrivateKey = null;
		this.joinerPublicKeyBySenderId.clear();
		this.joinerSigningPublicKeyBySenderId.clear();
		this.keyVersion = null;
		E2EEMeeting.instance.wipeMeetingContext();
	}

	teardownForDisconnect(): void {
		this.meetingSecret?.fill(0);
		this.meetingSecret = null;
		this.joinerX25519PrivateKey = null;
		this.joinerX25519PublicKeyBase64 = null;
		this.hostX25519PrivateKey = null;
		this.hostX25519PublicKeyBase64 = null;
		this.joinerPublicKeyBySenderId.clear();
		this.keyVersion = null;
		E2EEMeeting.instance.wipeMeetingContext();
	}

	// ── intent: joiner handshake ────────────────────────────────────────

	async startHandshakeAsJoiner(
		hostX25519PublicKeyBase64Param: string,
		hostSigningPublicKeyBase64: string,
		keyVersionString: string,
	): Promise<void> {
		const kp = await x25519KeyPair();
		this.joinerX25519PrivateKey = kp.privateKey;
		this.joinerX25519PublicKeyBase64 = await exportPublicKey(kp.publicKey);
		this.keyVersion = this.parseKeyVersion(keyVersionString);
		this.hostX25519PublicKeyBase64 = hostX25519PublicKeyBase64Param;
		this.hostSigningPublicKey = hostSigningPublicKeyBase64
			? await importEd25519PublicKey(hostSigningPublicKeyBase64)
			: null;
		await this.announceSigningKey();
	}

	async handleHandshakeEnvelope(data: HandshakeMessage): Promise<void> {
		if (!data.envelope) return;

		const envelopeHostX25519PublicKey =
			data.hostX25519PublicKey || this.hostX25519PublicKeyBase64;
		if (
			!this.joinerX25519PrivateKey ||
			!envelopeHostX25519PublicKey ||
			!this.hostX25519PublicKeyBase64 ||
			envelopeHostX25519PublicKey !== this.hostX25519PublicKeyBase64 ||
			this.keyVersion == null
		) {
			return;
		}
		if (
			data.toParticipantId &&
			data.toParticipantId !== this.ownParticipantId()
		) {
			return;
		}
		if (!this.hostSigningPublicKey) return;

		const kp: CryptoKeyPair = {
			privateKey: this.joinerX25519PrivateKey,
			publicKey: null as unknown as CryptoKey,
		};
		let result: {
			meetingSecret: Uint8Array<ArrayBuffer>;
			hostSigningPublicKey: Uint8Array<ArrayBuffer>;
		};
		try {
			result = await this.openJoinerEnvelope(
				kp,
				envelopeHostX25519PublicKey,
				this.hostSigningPublicKey,
				data.envelope,
				{ meetingId: this.meetingId, keyVersion: this.keyVersion },
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
		this.meetingSecret = result.meetingSecret;
		const identity = await this.getDeviceIdentity();
		this.dispatchHandshakeComplete(
			result.meetingSecret,
			identity.signingKeyPair.privateKey,
		);
	}

	// ── intent: host hello handling ─────────────────────────────────────

	async handleJoinerHello(data: JoinerHello): Promise<void> {
		if (data.fromParticipantId === this.ownParticipantId()) return;
		if (!data.x25519PublicKey || !data.signingPublicKey) return;

		this.joinerPublicKeyBySenderId.set(data.fromSenderId, data.x25519PublicKey);
		this.joinerSigningPublicKeyBySenderId.set(
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

		if (!this.meetingSecret || this.keyVersion == null) {
			this.pendingJoinerHellos.push({ ...data });
			return;
		}
		if (!this.hostX25519PrivateKey) return;

		const identity = await this.getDeviceIdentity();
		if (!this.identitySigningPublicKeyBase64) {
			this.identitySigningPublicKeyBase64 = identity.signingPublicKey;
		}
		if (!this.identitySigningPublicKeyBase64) {
			console.warn("[E2EE] handleJoinerHello: host signing key missing");
			return;
		}

		const hostX25519PubB64 = this.hostX25519PublicKeyBase64 ?? "";
		if (!hostX25519PubB64) {
			console.log(
				"[E2EE] handleJoinerHello: host priv exists but pub not exported yet, returning",
			);
			return;
		}
		const hostX25519PublicKeyBytes = bytesFromBase64(hostX25519PubB64);
		const hostSigningPublicKeyBytes = bytesFromBase64(
			this.identitySigningPublicKeyBase64,
		);

		const envelope = await this.buildHostEnvelope(
			this.hostX25519PrivateKey,
			identity.signingKeyPair.privateKey,
			data.x25519PublicKey,
			hostX25519PublicKeyBytes,
			hostSigningPublicKeyBytes,
			this.meetingSecret,
			{ meetingId: this.meetingId, keyVersion: this.keyVersion },
		);
		const ownSenderId = this.sfuClient.getOwnSenderId?.() ?? 0;
		this.sfuClient.signalChannel.emit("e2ee:handshake", {
			fromParticipantId: this.ownParticipantId(),
			fromSenderId: ownSenderId,
			toParticipantId: data.fromParticipantId,
			toSenderId: data.fromSenderId,
			envelope,
			hostX25519PublicKey: hostX25519PubB64,
			hostSigningPublicKey: this.identitySigningPublicKeyBase64,
		});
	}

	// ── intent: host E2EE key set ──────────────────────────────────────

	async handleHostE2EEKeySet(detail: {
		hostX25519KeyPair: CryptoKeyPair;
		keyVersion: string;
		hostSigningKeyPair?: CryptoKeyPair;
	}): Promise<void> {
		this.hostX25519PrivateKey = detail.hostX25519KeyPair.privateKey;
		this.hostX25519PublicKeyBase64 = null;
		this.keyVersion = this.parseKeyVersion(detail.keyVersion);

		const pubB64 = await exportPublicKey(detail.hostX25519KeyPair.publicKey);
		this.hostX25519PublicKeyBase64 = pubB64;
		if (detail?.hostSigningKeyPair) {
			this.hostSigningPrivateKey = detail.hostSigningKeyPair.privateKey;
			this.identitySigningPublicKeyBase64 = await exportEd25519PublicKey(
				detail.hostSigningKeyPair.publicKey,
			);
		}
		if (this.sfuClient) {
			this.sfuClient.setE2EERequired(true, {
				hostPublicKey: pubB64,
				hostSigningPublicKey: this.identitySigningPublicKeyBase64 ?? null,
				keyVersion: detail.keyVersion,
			});
		}

		await this.generateHostMeetingSecret();

		if (this.isReconfiguringForE2EE) return;
		this.isReconfiguringForE2EE = true;
		try {
			// Re-assert E2EE state after refreshToken (server may be stale).
			this.sfuClient.setE2EERequired(true, {
				hostPublicKey: pubB64,
				hostSigningPublicKey: this.identitySigningPublicKeyBase64 ?? null,
				keyVersion: detail.keyVersion,
			});
			await this.reconfigureMediaForE2EE();
		} catch (error) {
			console.error("Failed to reconfigure host for E2EE:", error);
		} finally {
			this.isReconfiguringForE2EE = false;
		}
	}

	// ── intent: host meeting-secret generation ─────────────────────────

	async generateHostMeetingSecret(): Promise<void> {
		const ms = new Uint8Array(32);
		globalThis.crypto.getRandomValues(ms);
		this.meetingSecret = ms;
		const identity = await this.getDeviceIdentity();
		this.dispatchHandshakeComplete(ms, identity.signingKeyPair.privateKey);
		this.flushPendingJoinerHellos();
	}

	// ── pending-hello queue ────────────────────────────────────────────

	private flushPendingJoinerHellos(): void {
		if (!this.meetingSecret || this.keyVersion == null) return;
		const selfId = this.ownParticipantId();
		const pending = this.pendingJoinerHellos.splice(0);
		for (const hello of pending) {
			if (hello.fromParticipantId === selfId) continue;
			void this.handleJoinerHello(hello);
		}
	}

	// ── intent: handshake-complete → set meeting context ───────────────

	setMeetingContext(
		meetingSecret: Uint8Array<ArrayBuffer>,
		keyVersion: number,
		signingPrivateKey: CryptoKey,
	): void {
		this.meetingSecret = meetingSecret;
		this.keyVersion = keyVersion;
		E2EEMeeting.instance.setMeetingContext(
			meetingSecret,
			keyVersion,
			signingPrivateKey,
		);
		this.flushPendingJoinerHellos();
	}

	// ── intent: handshake dispatch ─────────────────────────────────────

	handleHandshakeMessage(data: unknown): void {
		if (!data || typeof data !== "object") return;
		const msg = data as HandshakeMessage;
		if (msg.envelope) {
			void this.handleHandshakeEnvelope(msg);
		} else if (msg.x25519PublicKey) {
			void this.handleJoinerHello({
				fromParticipantId: msg.fromParticipantId ?? "",
				fromSenderId: msg.fromSenderId ?? 0,
				x25519PublicKey: msg.x25519PublicKey,
				signingPublicKey: msg.signingPublicKey ?? "",
			});
		}
	}

	// ── intent: resync ─────────────────────────────────────────────────

	resyncHandshake(): void {
		this.wipeRuntimeState();
		if (!this.hostX25519PublicKeyBase64) return;
		if (!this.sfuManager.value || !this.sfuClient.connected) return;
		const hostSigningPubB64 =
			this.sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
		if (!hostSigningPubB64) return;
		void this.startHandshakeAsJoiner(
			this.hostX25519PublicKeyBase64,
			hostSigningPubB64,
			this.sfuClient.connectionDetails.e2eeKeyVersion ?? "",
		);
	}

	handleSFUReconnect(): void {
		if (this.isCurrentTabHost.value) return;
		if (!this.meetingSecret) return;
		this.resyncHandshake();
	}

	// ── intent: prepare joining handshake ──────────────────────────────

	async prepareJoiningHandshakeIfRequired(): Promise<void> {
		if (!this.sfuClient.isE2EERequired() || this.meetingSecret) return;

		const identity = await this.getDeviceIdentity();
		this.identitySigningPublicKeyBase64 = identity.signingPublicKey;

		const hostPublicKeyBase64 =
			this.sfuClient.connectionDetails.e2eeHostPublicKey;
		const hostSigningPubB64 =
			this.sfuClient.connectionDetails.e2eeHostSigningPublicKey ?? "";
		const hostUserId = this.sfuClient.connectionDetails.e2eeHostUserId;
		const versionString = this.sfuClient.connectionDetails.e2eeKeyVersion ?? "";
		if (hostPublicKeyBase64 && (hostSigningPubB64 || hostUserId)) {
			void this.startHandshakeAsJoiner(
				hostPublicKeyBase64,
				hostSigningPubB64,
				versionString,
			);
			await this.waitForHandshakeComplete(10000);
		} else {
			throw new Error("E2EE is required but host key metadata is missing");
		}
	}

	private waitForHandshakeComplete(timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.meetingSecret) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				reject(new Error("E2EE handshake timed out"));
			}, timeoutMs);
			const listener = () => {
				if (this.meetingSecret) {
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
	}

	// ── intent: joiner meeting-E2EE-enabled handler ────────────────────

	async handleMeetingE2EEEnabled(data: {
		meeting_id?: string;
		e2ee_host_public_key?: string;
		e2ee_host_signing_public_key?: string;
		e2ee_key_version?: string;
	}): Promise<void> {
		if (data.meeting_id !== this.meetingId) return;
		if (this.isCurrentTabHost.value) return;
		if (this.isReconfiguringForE2EE) return;

		if (data.e2ee_host_public_key && data.e2ee_key_version) {
			const hostSigningPubB64 = data.e2ee_host_signing_public_key ?? "";
			if (!hostSigningPubB64) {
				console.error(
					"[E2EE] meeting:e2ee_enabled missing host signing pubkey",
				);
				return;
			}
			try {
				await this.startHandshakeAsJoiner(
					data.e2ee_host_public_key,
					hostSigningPubB64,
					data.e2ee_key_version,
				);
				await this.waitForHandshakeComplete(10000);
			} catch (err) {
				console.error("E2EE handshake (joiner) failed:", err);
				toast.error(E2EE_KEY_HOLDER_TIMEOUT_MESSAGE);
				return;
			}
		}

		this.sfuClient?.setE2EERequired(Boolean(data.e2ee_host_public_key), {
			hostPublicKey: data.e2ee_host_public_key ?? null,
			hostSigningPublicKey: data.e2ee_host_signing_public_key ?? null,
			keyVersion: data.e2ee_key_version ?? null,
		});

		this.isReconfiguringForE2EE = true;
		try {
			await this.reconfigureMediaForE2EE();
		} catch (error) {
			console.error("Failed to reconfigure for E2EE:", error);
		} finally {
			this.isReconfiguringForE2EE = false;
		}
	}
}
