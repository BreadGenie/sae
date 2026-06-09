import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEEpochSignalingController } from "../E2EEEpochSignalingController";

function createController() {
	const sendE2EEEpochEnvelope = vi.fn();
	const generateKeyPackage = vi.fn(async () => ({
		publicPackage: { id: "public-package" } as never,
		privatePackage: { id: "private-package" } as never,
	}));
	const encodeKeyPackage = vi.fn(
		(_keyPackage: unknown) => new Uint8Array([1, 2, 3]),
	);
	const controller = new E2EEEpochSignalingController({
		meetingId: "meeting-1",
		sfuClient: {
			getOwnSenderId: vi.fn(() => 7),
			sendE2EEEpochEnvelope,
		} as never,
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1" }),
		} as never,
		isCurrentTabHost: shallowRef(false),
		getDeviceIdentity: vi.fn(async () => ({
			deviceId: "device-1",
			signingPublicKey: "signing-public-key",
			signingKeyPair: {} as CryptoKeyPair,
		})),
		epochProtocolProvider: {
			createGenesisEpoch: vi.fn(),
			generateKeyPackage,
			encodeKeyPackage,
			addMember: vi.fn(),
			joinFromWelcome: vi.fn(),
			exportMeetingSecret: vi.fn(),
		},
	});
	return { controller, sendE2EEEpochEnvelope, generateKeyPackage };
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
});
