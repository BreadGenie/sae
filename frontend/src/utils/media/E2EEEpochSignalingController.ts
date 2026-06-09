import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { SFUClient } from "../SFUClient";
import type { E2eeEpochEnvelope } from "./E2EEEpochSignaling";
import {
	getActiveEpochState,
	installActiveEpochState,
} from "./E2EEEpochStateStore";
import { E2EEMeeting } from "./E2EEMeeting";
import {
	type EpochProtocolProvider,
	TsMlsEpochProtocolProvider,
} from "./EpochProtocolProvider";
import { bufferToBase64, bytesFromBase64 } from "./e2eePrimitives";

type DeviceIdentity = {
	deviceId: string;
	signingPublicKey: string;
	signingKeyPair: CryptoKeyPair;
};

type PendingKeyPackage = Awaited<
	ReturnType<EpochProtocolProvider["generateKeyPackage"]>
>;

interface E2EEEpochSignalingControllerDeps {
	meetingId: string;
	sfuClient: SFUClient;
	currentUser: CurrentUser;
	isCurrentTabHost: Ref<boolean>;
	getDeviceIdentity: () => Promise<DeviceIdentity>;
	epochProtocolProvider?: EpochProtocolProvider;
}

export class E2EEEpochSignalingController {
	private readonly deps: E2EEEpochSignalingControllerDeps;
	private readonly epochProtocolProvider: EpochProtocolProvider;
	private readonly pendingKeyPackagesByEpoch = new Map<
		number,
		PendingKeyPackage
	>();
	private readonly receivedKeyPackagesBySenderId = new Map<
		number,
		{ epochNumber: number; participantId: string; keyPackage: string }
	>();

	constructor(deps: E2EEEpochSignalingControllerDeps) {
		this.deps = deps;
		this.epochProtocolProvider =
			deps.epochProtocolProvider ?? new TsMlsEpochProtocolProvider();
	}

	async handleEpochEnvelope(data: unknown): Promise<void> {
		if (!this.isEpochEnvelope(data)) return;
		switch (data.type) {
			case "key-package-request":
				await this.publishKeyPackage(data.epochNumber);
				return;
			case "commit-request":
				if (this.shouldAuthorCommit(data.committerSenderId)) {
					await this.authorAddMemberCommit(data);
				}
				return;
			case "key-package":
				this.receivedKeyPackagesBySenderId.set(data.fromSenderId, {
					epochNumber: data.epochNumber,
					participantId: data.fromParticipantId,
					keyPackage: data.keyPackage,
				});
				return;
			case "commit":
			case "welcome":
			case "ack":
			case "resync-request":
				return;
		}
	}

	getPendingKeyPackage(epochNumber: number): PendingKeyPackage | null {
		return this.pendingKeyPackagesByEpoch.get(epochNumber) ?? null;
	}

	clearPendingKeyPackages(): void {
		this.pendingKeyPackagesByEpoch.clear();
		this.receivedKeyPackagesBySenderId.clear();
	}

	private async publishKeyPackage(epochNumber: number): Promise<void> {
		const senderId = this.deps.sfuClient.getOwnSenderId();
		if (senderId === null) return;

		const identity = await this.deps.getDeviceIdentity();
		const userId = this.deps.currentUser.currentUser.value?.user_id;
		if (!userId) return;

		const keyPackage = await this.epochProtocolProvider.generateKeyPackage({
			groupId: this.deps.meetingId,
			userId,
			deviceId: identity.deviceId,
			senderId,
		});
		this.pendingKeyPackagesByEpoch.set(epochNumber, keyPackage);

		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "key-package",
			fromParticipantId: userId,
			fromSenderId: senderId,
			epochNumber,
			keyPackage: bufferToBase64(
				this.epochProtocolProvider.encodeKeyPackage(keyPackage.publicPackage),
			),
		});
	}

	private shouldAuthorCommit(committerSenderId: number): boolean {
		return (
			this.deps.isCurrentTabHost.value &&
			this.deps.sfuClient.getOwnSenderId() === committerSenderId
		);
	}

	private async authorAddMemberCommit(
		request: Extract<E2eeEpochEnvelope, { type: "commit-request" }>,
	): Promise<void> {
		const activeEpoch = getActiveEpochState();
		if (!activeEpoch || activeEpoch.epochNumber !== request.epochNumber) return;

		const joiningPackage = this.findJoiningKeyPackage(request.epochNumber);
		if (!joiningPackage) return;

		const decodedKeyPackage = this.epochProtocolProvider.decodeKeyPackage(
			bytesFromBase64(joiningPackage.keyPackage),
		);
		const nextEpoch = await this.epochProtocolProvider.addMember(
			activeEpoch.state,
			decodedKeyPackage,
		);
		const identity = await this.deps.getDeviceIdentity();

		installActiveEpochState({
			epochNumber: nextEpoch.epochNumber,
			state: nextEpoch.state,
			meetingSecret: nextEpoch.meetingSecret,
		});
		E2EEMeeting.instance.setMeetingContext(
			nextEpoch.meetingSecret,
			nextEpoch.epochNumber,
			identity.signingKeyPair.privateKey,
		);

		const fromSenderId = this.deps.sfuClient.getOwnSenderId();
		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		if (fromSenderId === null || !fromParticipantId) return;

		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "commit",
			fromParticipantId,
			fromSenderId,
			previousEpochNumber: request.epochNumber,
			epochNumber: nextEpoch.epochNumber,
			membershipDeltaId: request.membershipDeltaId,
			membershipDeltaHash: request.membershipDeltaHash,
			rosterHash: request.rosterHash,
			mlsCommit: bufferToBase64(
				this.epochProtocolProvider.encodeCommit(nextEpoch.commit),
			),
		});
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "welcome",
			fromParticipantId,
			fromSenderId,
			toParticipantId: joiningPackage.participantId,
			toSenderId: joiningPackage.senderId,
			epochNumber: nextEpoch.epochNumber,
			mlsWelcome: bufferToBase64(
				this.epochProtocolProvider.encodeWelcome(nextEpoch.welcome),
			),
		});
	}

	private findJoiningKeyPackage(epochNumber: number): {
		senderId: number;
		participantId: string;
		keyPackage: string;
	} | null {
		const ownSenderId = this.deps.sfuClient.getOwnSenderId();
		for (const [senderId, entry] of this.receivedKeyPackagesBySenderId) {
			if (senderId === ownSenderId || entry.epochNumber !== epochNumber)
				continue;
			return {
				senderId,
				participantId: entry.participantId,
				keyPackage: entry.keyPackage,
			};
		}
		return null;
	}

	private isEpochEnvelope(value: unknown): value is E2eeEpochEnvelope {
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			typeof value.type === "string"
		);
	}
}
