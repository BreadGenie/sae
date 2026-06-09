import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { MediaState } from "../../composables/useMediaState";
import type { SFUClient } from "../SFUClient";
import type { SFUMeetingManager } from "../SFUMeetingManager";
import {
	installActiveEpochState,
	wipeActiveEpochState,
} from "./E2EEEpochStateStore";
import { E2EEMeeting } from "./E2EEMeeting";
import {
	type EpochProtocolProvider,
	TsMlsEpochProtocolProvider,
} from "./EpochProtocolProvider";

interface E2EEHandshakeControllerDeps {
	meetingId: string;
	sfuClient: SFUClient;
	sfuManager: Ref<SFUMeetingManager | null>;
	currentUser: CurrentUser;
	mediaState: MediaState;
	isCurrentTabHost: Ref<boolean>;
	getDeviceIdentity: () => Promise<{
		deviceId: string;
		signingPublicKey: string;
		signingKeyPair: CryptoKeyPair;
	}>;
	epochProtocolProvider?: EpochProtocolProvider;
}

export class E2EEHandshakeController {
	private readonly deps: E2EEHandshakeControllerDeps;
	private readonly epochProtocolProvider: EpochProtocolProvider;
	meetingSecret: Uint8Array<ArrayBuffer> | null = null;
	keyVersion: number | null = null;
	isReconfiguringForE2EE = false;

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
		this.epochProtocolProvider =
			deps.epochProtocolProvider ?? new TsMlsEpochProtocolProvider();
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

	private get getDeviceIdentity(): E2EEHandshakeControllerDeps["getDeviceIdentity"] {
		return this.deps.getDeviceIdentity;
	}

	private ownParticipantId(): string {
		return this.currentUser.currentUser.value?.user_id ?? "";
	}

	wipeRuntimeState(): void {
		this.meetingSecret?.fill(0);
		this.meetingSecret = null;
		this.keyVersion = null;
		wipeActiveEpochState();
		E2EEMeeting.instance.wipeMeetingContext();
	}

	teardownForDisconnect(): void {
		this.wipeRuntimeState();
	}

	async handleHostE2EEKeySet(_detail: { keyVersion?: string }): Promise<void> {
		await this.generateHostMeetingSecret();
		if (this.isReconfiguringForE2EE) return;
		this.isReconfiguringForE2EE = true;
		try {
			this.sfuClient.setE2EERequired(true);
			await this.reconfigureMediaForE2EE();
		} catch (error) {
			console.error("Failed to reconfigure host for E2EE:", error);
		} finally {
			this.isReconfiguringForE2EE = false;
		}
	}

	async generateHostMeetingSecret(): Promise<void> {
		const identity = await this.getDeviceIdentity();
		const genesis = await this.epochProtocolProvider.createGenesisEpoch({
			groupId: this.meetingId,
			userId: this.ownParticipantId(),
			deviceId: identity.deviceId,
			senderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			signingPubKey: identity.signingPublicKey,
		});
		this.keyVersion = genesis.epochNumber;
		this.meetingSecret = genesis.meetingSecret;
		installActiveEpochState({
			epochNumber: genesis.epochNumber,
			state: genesis.state,
			meetingSecret: genesis.meetingSecret,
		});
		this.onHandshakeComplete?.({
			meetingId: this.meetingId,
			meetingSecret: genesis.meetingSecret,
			keyVersion: genesis.epochNumber,
			signingPrivateKey: identity.signingKeyPair.privateKey,
		});
	}

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
	}

	handleSFUReconnect(): void {
		if (this.deps.isCurrentTabHost.value) return;
		this.wipeRuntimeState();
		this.sfuClient.sendE2EEEpochEnvelope({
			type: "resync-request",
			fromParticipantId: this.ownParticipantId(),
			fromSenderId: this.sfuClient.getOwnSenderId?.() ?? 0,
			knownEpochNumber: this.keyVersion ?? undefined,
		});
	}

	async handleMeetingE2EEEnabled(data: { meeting_id?: string }): Promise<void> {
		if (data.meeting_id !== this.meetingId) return;
		if (this.deps.isCurrentTabHost.value) return;
		this.sfuClient.setE2EERequired(true);
	}

	private async reconfigureMediaForE2EE(): Promise<void> {
		if (!this.sfuClient?.isConnected?.()) return;

		const hadCamera = this.mediaState.isCameraOn;
		const hadMic = this.mediaState.isMicOn;
		const videoStreamForRepublish =
			this.mediaState.processedStream || this.mediaState.localStream;
		const audioStreamForRepublish = this.mediaState.localStream;

		await this.sfuClient.refreshToken();
		await this.sfuClient.joinRoom(
			this.meetingId,
			{
				userId: this.currentUser.currentUser.value?.user_id || "",
				name:
					this.currentUser.currentUser.value?.full_name ||
					this.currentUser.currentUser.value?.name ||
					"",
				avatar: this.currentUser.currentUser.value?.avatar || null,
				is_guest: this.currentUser.currentUser.value?.is_guest || false,
			},
			{
				audio_enabled: this.mediaState.isMicOn,
				video_enabled: this.mediaState.isCameraOn,
			},
		);

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
}
