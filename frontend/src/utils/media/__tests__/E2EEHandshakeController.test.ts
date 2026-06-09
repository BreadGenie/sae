import { describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { E2EEHandshakeController } from "../E2EEHandshakeController";

function createController() {
	return new E2EEHandshakeController({
		meetingId: "meeting-1",
		sfuClient: {
			getOwnSenderId: vi.fn(() => 7),
			setE2EERequired: vi.fn(),
			isConnected: vi.fn(() => false),
		} as never,
		sfuManager: shallowRef(null),
		currentUser: {
			currentUser: shallowRef({ user_id: "user-1" }),
		} as never,
		mediaState: {} as never,
		isCurrentTabHost: shallowRef(false),
		getDeviceIdentity: vi.fn(async () => ({
			deviceId: "device-1",
			signingPublicKey: "signing-public-key",
			signingKeyPair: { privateKey: {} as CryptoKey } as CryptoKeyPair,
		})),
		epochProtocolProvider: {
			createGenesisEpoch: vi.fn(async () => ({
				epochNumber: 1,
				state: {} as never,
				encodedState: new Uint8Array([1]),
				meetingSecret: new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			})),
			generateKeyPackage: vi.fn(),
			encodeKeyPackage: vi.fn(),
			decodeKeyPackage: vi.fn(),
			encodeCommit: vi.fn(),
			encodeWelcome: vi.fn(),
			decodeWelcome: vi.fn(),
			addMember: vi.fn(),
			joinFromWelcome: vi.fn(),
			exportMeetingSecret: vi.fn(),
		},
	});
}

describe("E2EEHandshakeController", () => {
	it("installs the genesis epoch meeting secret when the host enables E2EE", async () => {
		const controller = createController();
		let installedSecret: Uint8Array<ArrayBuffer> | null = null;
		controller.onHandshakeComplete = (detail) => {
			installedSecret = detail.meetingSecret;
		};

		await controller.handleHostE2EEKeySet({
			keyVersion: "v1-test",
		});

		expect(controller.keyVersion).toBe(1);
		expect(installedSecret?.byteLength).toBe(32);
	});
});
