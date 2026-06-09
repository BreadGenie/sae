import { decodeGroupState } from "ts-mls";
import { describe, expect, it } from "vitest";
import { TsMlsEpochProtocolProvider } from "../EpochProtocolProvider";

describe("TsMlsEpochProtocolProvider", () => {
	it("creates a genesis epoch and exports a stable 32-byte meeting secret", async () => {
		const provider = new TsMlsEpochProtocolProvider();

		const genesis = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
		});

		expect(genesis.epochNumber).toBe(1);
		expect(genesis.encodedState.byteLength).toBeGreaterThan(0);
		expect(genesis.meetingSecret.byteLength).toBe(32);

		const reExportedSecret = await provider.exportMeetingSecret(genesis.state);
		expect([...reExportedSecret]).toEqual([...genesis.meetingSecret]);

		const decoded = decodeGroupState(genesis.encodedState, 0)?.[0];
		expect(decoded?.groupContext.epoch).toBe(genesis.state.groupContext.epoch);
	});

	it("adds a member and lets the joiner export the same epoch meeting secret", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const alice = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
		});
		const bobKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
		});

		const addBob = await provider.addMember(
			alice.state,
			bobKeyPackage.publicPackage,
		);
		const bob = await provider.joinFromWelcome(
			addBob.welcome,
			bobKeyPackage.publicPackage,
			bobKeyPackage.privatePackage,
			addBob.state.ratchetTree,
		);

		expect(addBob.epochNumber).toBe(2);
		expect(bob.epochNumber).toBe(2);
		expect([...bob.meetingSecret]).toEqual([...addBob.meetingSecret]);
		expect([...bob.meetingSecret]).not.toEqual([...alice.meetingSecret]);
	});
});
