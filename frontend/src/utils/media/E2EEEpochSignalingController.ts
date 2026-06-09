import type { Ref } from "vue";
import type { CurrentUser } from "../../composables/useCurrentUser";
import type { SFUClient } from "../SFUClient";
import type { E2eeEpochEnvelope } from "./E2EEEpochSignaling";
import {
	type EpochProtocolProvider,
	TsMlsEpochProtocolProvider,
} from "./EpochProtocolProvider";
import { bufferToBase64 } from "./e2eePrimitives";

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
					// Commit authoring needs SFU membership deltas and roster hashing.
					// This tracer only publishes key packages for the next slice.
				}
				return;
			case "commit":
			case "welcome":
			case "ack":
			case "key-package":
			case "resync-request":
				return;
		}
	}

	getPendingKeyPackage(epochNumber: number): PendingKeyPackage | null {
		return this.pendingKeyPackagesByEpoch.get(epochNumber) ?? null;
	}

	clearPendingKeyPackages(): void {
		this.pendingKeyPackagesByEpoch.clear();
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

	private isEpochEnvelope(value: unknown): value is E2eeEpochEnvelope {
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			typeof value.type === "string"
		);
	}
}
