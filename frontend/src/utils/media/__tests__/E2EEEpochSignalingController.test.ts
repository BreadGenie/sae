import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEEpochSignalingController } from "../E2EEEpochSignalingController";
import {
	installActiveEpochState,
	wipeActiveEpochState,
} from "../E2EEEpochStateStore";

function createController(options: { isHost?: boolean } = {}) {
	const sendE2EEEpochEnvelope = vi.fn();
	const generateKeyPackage = vi.fn(async () => ({
		publicPackage: { id: "public-package" } as never,
		privatePackage: { id: "private-package" } as never,
	}));
	const addMember = vi.fn(async () => ({
		epochNumber: 2,
		state: { id: "epoch-2-state" } as never,
		encodedState: new Uint8Array([8]),
		meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		commit: { id: "commit" } as never,
		welcome: { id: "welcome" } as never,
	}));
	const encodeKeyPackage = vi.fn(
		(_keyPackage: unknown) => new Uint8Array([1, 2, 3]),
	);
	const decodeKeyPackage = vi.fn(
		(_encoded: Uint8Array) =>
			({
				id: "decoded-key-package",
			}) as never,
	);
	const encodeCommit = vi.fn((_commit: unknown) => new Uint8Array([4, 5, 6]));
	const encodeWelcome = vi.fn((_welcome: unknown) => new Uint8Array([7, 8, 9]));
	const decodeWelcome = vi.fn(
		(_encoded: Uint8Array) =>
			({
				id: "decoded-welcome",
			}) as never,
	);
	const joinFromWelcome = vi.fn(async () => ({
		epochNumber: 2,
		state: { id: "joined-epoch-2-state" } as never,
		encodedState: new Uint8Array([10]),
		meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
	}));
	const controller = new E2EEEpochSignalingController({
		meetingId: "meeting-1",
		sfuClient: {
			getOwnSenderId: vi.fn(() => 7),
			sendE2EEEpochEnvelope,
		} as never,
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1" }),
		} as never,
		isCurrentTabHost: shallowRef(Boolean(options.isHost)),
		getDeviceIdentity: vi.fn(async () => ({
			deviceId: "device-1",
			signingPublicKey: "signing-public-key",
			signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
		})),
		epochProtocolProvider: {
			createGenesisEpoch: vi.fn(),
			generateKeyPackage,
			encodeKeyPackage,
			decodeKeyPackage,
			encodeCommit,
			encodeWelcome,
			decodeWelcome,
			addMember,
			joinFromWelcome,
			processCommit: vi.fn(),
			exportMeetingSecret: vi.fn(),
		},
	});
	return {
		controller,
		sendE2EEEpochEnvelope,
		generateKeyPackage,
		addMember,
		joinFromWelcome,
	};
}

describe("E2EEEpochSignalingController", () => {
	it("publishes an MLS key package when the SFU requests one", async () => {
		const { controller, sendE2EEEpochEnvelope, generateKeyPackage } =
			createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "enable",
		});

		expect(generateKeyPackage).toHaveBeenCalledWith({
			groupId: "meeting-1",
			userId: "user-1",
			deviceId: "device-1",
			senderId: 7,
			signingPubKey: "signing-public-key",
		});
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith({
			type: "key-package",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 1,
			keyPackage: "AQID",
		});
		expect(controller.getPendingKeyPackage(1)).not.toBeNull();
	});

	it("authors an add-member commit when this host is the designated committer", async () => {
		installActiveEpochState({
			epochNumber: 1,
			state: { id: "epoch-1-state" } as never,
			meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
		});
		const { controller, sendE2EEEpochEnvelope, addMember } = createController({
			isHost: true,
		});

		await controller.handleEpochEnvelope({
			type: "key-package",
			fromParticipantId: "joiner-1",
			fromSenderId: 9,
			epochNumber: 1,
			keyPackage: "AQID",
		});
		await controller.handleEpochEnvelope({
			type: "commit-request",
			epochNumber: 1,
			nextEpochNumber: 2,
			membershipDeltaId: "delta-1",
			membershipDeltaHash: "ZGVsdGE=",
			rosterHash: "cm9zdGVy",
			committerSenderId: 7,
		});

		expect(addMember).toHaveBeenCalled();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "commit",
				previousEpochNumber: 1,
				epochNumber: 2,
				mlsCommit: "BAUG",
			}),
		);
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "welcome",
				toParticipantId: "joiner-1",
				toSenderId: 9,
				epochNumber: 2,
				mlsWelcome: "BwgJ",
			}),
		);
		wipeActiveEpochState();
	});

	it("joins from a targeted welcome and acknowledges the installed epoch", async () => {
		const { controller, sendE2EEEpochEnvelope, joinFromWelcome } =
			createController();

		await controller.handleEpochEnvelope({
			type: "key-package-request",
			epochNumber: 1,
			reason: "join",
		});
		await controller.handleEpochEnvelope({
			type: "welcome",
			fromParticipantId: "host-1",
			fromSenderId: 7,
			toParticipantId: "user-1",
			toSenderId: 7,
			epochNumber: 2,
			mlsWelcome: "BwgJ",
		});

		expect(joinFromWelcome).toHaveBeenCalled();
		expect(controller.getPendingKeyPackage(1)).toBeNull();
		expect(sendE2EEEpochEnvelope).toHaveBeenCalledWith({
			type: "ack",
			fromParticipantId: "user-1",
			fromSenderId: 7,
			epochNumber: 2,
		});
		wipeActiveEpochState();
	});
});
