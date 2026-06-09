import { getGroupMembers } from "ts-mls/clientState.js";
import { decodeMlsMessage } from "ts-mls/message.js";
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
	onEpochInstalled?: () => void;
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
				await this.processCommit(data);
				return;
			case "ack":
			case "resync-request":
				return;
			case "welcome":
				await this.processWelcome(data);
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
			signingPubKey: identity.signingPublicKey,
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
		this.deps.onEpochInstalled?.();
		await this.syncSenderSigningPubs(nextEpoch.state);

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

	private async processCommit(
		commitEnvelope: Extract<E2eeEpochEnvelope, { type: "commit" }>,
	): Promise<void> {
		const activeEpoch = getActiveEpochState();
		if (
			!activeEpoch ||
			activeEpoch.epochNumber !== commitEnvelope.previousEpochNumber
		)
			return;

		const [decodedCommit] = decodeMlsMessage(
			bytesFromBase64(commitEnvelope.mlsCommit),
			0,
		);
		const nextEpoch = await this.epochProtocolProvider.processCommit(
			activeEpoch.state,
			decodedCommit,
		);
		if (nextEpoch.epochNumber !== commitEnvelope.epochNumber) return;

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
		this.deps.onEpochInstalled?.();
		await this.syncSenderSigningPubs(nextEpoch.state);

		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		const fromSenderId = this.deps.sfuClient.getOwnSenderId();
		if (!fromParticipantId || fromSenderId === null) return;
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "ack",
			fromParticipantId,
			fromSenderId,
			epochNumber: nextEpoch.epochNumber,
		});
	}

	private async processWelcome(
		welcomeEnvelope: Extract<E2eeEpochEnvelope, { type: "welcome" }>,
	): Promise<void> {
		const ownSenderId = this.deps.sfuClient.getOwnSenderId();
		if (ownSenderId === null || welcomeEnvelope.toSenderId !== ownSenderId)
			return;

		const pendingKeyPackage = this.pendingKeyPackagesByEpoch.get(
			welcomeEnvelope.epochNumber - 1,
		);
		if (!pendingKeyPackage) return;

		const welcome = this.epochProtocolProvider.decodeWelcome(
			bytesFromBase64(welcomeEnvelope.mlsWelcome),
		);
		const nextEpoch = await this.epochProtocolProvider.joinFromWelcome(
			welcome,
			pendingKeyPackage.publicPackage,
			pendingKeyPackage.privatePackage,
		);
		if (nextEpoch.epochNumber !== welcomeEnvelope.epochNumber) return;

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
		this.deps.onEpochInstalled?.();
		await this.syncSenderSigningPubs(nextEpoch.state);
		this.pendingKeyPackagesByEpoch.delete(welcomeEnvelope.epochNumber - 1);

		const fromParticipantId = this.deps.currentUser.currentUser.value?.user_id;
		if (!fromParticipantId) return;
		this.deps.sfuClient.sendE2EEEpochEnvelope({
			type: "ack",
			fromParticipantId,
			fromSenderId: ownSenderId,
			epochNumber: nextEpoch.epochNumber,
		});
	}

	private async syncSenderSigningPubs(
		state: import("ts-mls").ClientState,
	): Promise<void> {
		let members: import("ts-mls").LeafNode[];
		try {
			members = getGroupMembers(state);
		} catch {
			return;
		}
		for (const leaf of members) {
			if (leaf.credential.credentialType !== "basic") continue;
			const identity = JSON.parse(
				new TextDecoder().decode(leaf.credential.identity),
			);
			if (
				typeof identity.senderId !== "number" ||
				typeof identity.signingPubKey !== "string"
			)
				continue;
			if (E2EEMeeting.instance.hasSenderSigningPub(identity.senderId)) continue;
			const rawKey = bytesFromBase64(identity.signingPubKey);
			const cryptoKey = await crypto.subtle.importKey(
				"raw",
				rawKey as BufferSource,
				"Ed25519",
				true,
				["verify"],
			);
			E2EEMeeting.instance.setSenderSigningPub(identity.senderId, cryptoKey);
		}
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
