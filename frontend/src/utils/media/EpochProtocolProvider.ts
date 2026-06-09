import {
	type ClientState,
	type Credential,
	createCommit,
	createGroup,
	defaultCapabilities,
	defaultLifetime,
	emptyPskIndex,
	encodeGroupState,
	generateKeyPackage,
	getCiphersuiteFromName,
	getCiphersuiteImpl,
	joinGroup,
	type KeyPackage,
	type MLSMessage,
	mlsExporter,
	type PrivateKeyPackage,
	type Proposal,
	type RatchetTree,
	type Welcome,
	zeroOutUint8Array,
} from "ts-mls";
import { decodeKeyPackage, encodeKeyPackage } from "ts-mls/keyPackage.js";
import { encodeMlsMessage } from "ts-mls/message.js";
import { decodeWelcome, encodeWelcome } from "ts-mls/welcome.js";

const MEET_MLS_CIPHERSUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const MEET_MLS_MEETING_SECRET_LABEL = "meet-e2ee|meeting-secret|v1";

type EpochMemberInput = {
	groupId: string;
	userId: string;
	deviceId: string;
	senderId: number;
};

type EpochStateResult = {
	epochNumber: number;
	state: ClientState;
	encodedState: Uint8Array;
	meetingSecret: Uint8Array<ArrayBuffer>;
};

type EpochKeyPackage = {
	publicPackage: KeyPackage;
	privatePackage: PrivateKeyPackage;
};

type AddMemberResult = EpochStateResult & {
	commit: MLSMessage;
	welcome: Welcome;
};

export interface EpochProtocolProvider {
	createGenesisEpoch(input: EpochMemberInput): Promise<EpochStateResult>;
	generateKeyPackage(input: EpochMemberInput): Promise<EpochKeyPackage>;
	encodeKeyPackage(keyPackage: KeyPackage): Uint8Array;
	decodeKeyPackage(encoded: Uint8Array): KeyPackage;
	encodeCommit(commit: MLSMessage): Uint8Array;
	encodeWelcome(welcome: Welcome): Uint8Array;
	decodeWelcome(encoded: Uint8Array): Welcome;
	addMember(
		state: ClientState,
		joiningMember: KeyPackage,
	): Promise<AddMemberResult>;
	joinFromWelcome(
		welcome: Welcome,
		keyPackage: KeyPackage,
		privateKeyPackage: PrivateKeyPackage,
		ratchetTree?: RatchetTree,
	): Promise<EpochStateResult>;
	exportMeetingSecret(state: ClientState): Promise<Uint8Array<ArrayBuffer>>;
}

export class TsMlsEpochProtocolProvider implements EpochProtocolProvider {
	async createGenesisEpoch(input: EpochMemberInput): Promise<EpochStateResult> {
		const cipherSuite = await this.getCipherSuite();
		const keyPackage = await this.generateKeyPackage(input);
		const state = await createGroup(
			new TextEncoder().encode(input.groupId),
			keyPackage.publicPackage,
			keyPackage.privatePackage,
			[],
			cipherSuite,
		);
		return this.buildStateResult(state);
	}

	async generateKeyPackage(input: EpochMemberInput): Promise<EpochKeyPackage> {
		const cipherSuite = await this.getCipherSuite();
		return generateKeyPackage(
			this.buildCredential(input),
			defaultCapabilities(),
			defaultLifetime,
			[],
			cipherSuite,
		);
	}

	encodeKeyPackage(keyPackage: KeyPackage): Uint8Array {
		return encodeKeyPackage(keyPackage);
	}

	decodeKeyPackage(encoded: Uint8Array): KeyPackage {
		const decoded = decodeKeyPackage(encoded, 0);
		if (!decoded) {
			throw new Error("Invalid MLS key package");
		}
		return decoded[0];
	}

	encodeCommit(commit: MLSMessage): Uint8Array {
		return encodeMlsMessage(commit);
	}

	encodeWelcome(welcome: Welcome): Uint8Array {
		return encodeWelcome(welcome);
	}

	decodeWelcome(encoded: Uint8Array): Welcome {
		const decoded = decodeWelcome(encoded, 0);
		if (!decoded) {
			throw new Error("Invalid MLS welcome");
		}
		return decoded[0];
	}

	async addMember(
		state: ClientState,
		joiningMember: KeyPackage,
	): Promise<AddMemberResult> {
		const cipherSuite = await this.getCipherSuite();
		const addProposal: Proposal = {
			proposalType: "add",
			add: { keyPackage: joiningMember },
		};
		const commit = await createCommit(
			{ state, cipherSuite },
			{ extraProposals: [addProposal], ratchetTreeExtension: true },
		);
		commit.consumed.forEach(zeroOutUint8Array);
		if (!commit.welcome) {
			throw new Error("Add-member commit did not produce a welcome");
		}
		return {
			...(await this.buildStateResult(commit.newState)),
			commit: commit.commit,
			welcome: commit.welcome,
		};
	}

	async joinFromWelcome(
		welcome: Welcome,
		keyPackage: KeyPackage,
		privateKeyPackage: PrivateKeyPackage,
		ratchetTree?: RatchetTree,
	): Promise<EpochStateResult> {
		const cipherSuite = await this.getCipherSuite();
		const state = await joinGroup(
			welcome,
			keyPackage,
			privateKeyPackage,
			emptyPskIndex,
			cipherSuite,
			ratchetTree,
		);
		return this.buildStateResult(state);
	}

	async exportMeetingSecret(
		state: ClientState,
	): Promise<Uint8Array<ArrayBuffer>> {
		const cipherSuite = await this.getCipherSuite();
		const secret = await mlsExporter(
			state.keySchedule.exporterSecret,
			MEET_MLS_MEETING_SECRET_LABEL,
			new TextEncoder().encode(String(this.getMeetEpochNumber(state))),
			32,
			cipherSuite,
		);
		return secret as Uint8Array<ArrayBuffer>;
	}

	private async buildStateResult(
		state: ClientState,
	): Promise<EpochStateResult> {
		return {
			epochNumber: this.getMeetEpochNumber(state),
			state,
			encodedState: encodeGroupState(state),
			meetingSecret: await this.exportMeetingSecret(state),
		};
	}

	private getMeetEpochNumber(state: ClientState): number {
		return Number(state.groupContext.epoch) + 1;
	}

	private async getCipherSuite() {
		return getCiphersuiteImpl(getCiphersuiteFromName(MEET_MLS_CIPHERSUITE));
	}

	private buildCredential(input: EpochMemberInput): Credential {
		return {
			credentialType: "basic",
			identity: new TextEncoder().encode(
				JSON.stringify({
					userId: input.userId,
					deviceId: input.deviceId,
					senderId: input.senderId,
				}),
			),
		};
	}
}
