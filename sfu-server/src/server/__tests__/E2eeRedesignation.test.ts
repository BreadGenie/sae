// Smoke tests for the committer redesignation timer. Run via:
//   yarn test
//
// Verifies that:
//
//   1. When the designated committer doesn't respond with a commit within
//      COMMITTER_TIMEOUT_MS, the SFU emits a second commit-request to a
//      different committer.
//   2. When a commit envelope arrives for the matching delta, the
//      redesignation timer is cleared and no further commit-requests are
//      emitted.
//   3. After MAX_REDESIGNATIONS attempts, the SFU gives up and stops
//      emitting commit-requests.

import { E2EEEpochRelay } from '../E2EEEpochRelay';
import {
	InMemoryRosterPersistence,
	type RosterEntry,
} from '../E2eeRosterPersistence';
import { E2eeRosterStore } from '../E2eeRosterStore';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

function makeEntry(
	senderId: number,
	opts: Partial<RosterEntry> = {},
): RosterEntry {
	return {
		participantId: opts.participantId ?? `user-${senderId}`,
		senderId,
		isHost: opts.isHost ?? false,
		joinedAt: opts.joinedAt ?? Date.now(),
	};
}

async function main(): Promise<void> {
	const sent: Array<{
		room: string;
		target: string;
		committerSenderId: number;
		epochNumber: number;
		nextEpochNumber: number;
		membershipDeltaId: string;
		joiningSenderIds: number[];
	}> = [];
	const fakeIo = {
		sockets: {
			adapter: {
				rooms: new Map<string, Set<string>>(),
			},
			sockets: new Map<string, { id: string; data: { roomId?: string } }>(),
		},
	} as never;

	const relay = new E2EEEpochRelay(
		fakeIo,
		new Map<string, Set<string>>([
			['meeting-1', new Set(['host-socket', 'alice-socket', 'bob-socket'])],
		]),
		new Map<string, Map<string, number>>([
			[
				'meeting-1',
				new Map<string, number>([
					['host-1', 7],
					['alice-1', 9],
					['bob-1', 11],
				]),
			],
		]),
	);
	const roster = new E2eeRosterStore(new InMemoryRosterPersistence());
	await roster.add('meeting-1', makeEntry(7, { isHost: true, joinedAt: 1 }));
	await roster.add('meeting-1', makeEntry(9, { joinedAt: 2 }));
	await roster.add('meeting-1', makeEntry(11, { joinedAt: 3 }));
	relay.setRoster(roster);

	const originalEmit = (
		relay as unknown as { emitToTarget: Function }
	).emitToTarget.bind(relay);
	(relay as unknown as { emitToTarget: Function }).emitToTarget = (
		roomId: string,
		participantId: string,
		envelope: {
			type: string;
			committerSenderId?: number;
			epochNumber?: number;
			nextEpochNumber?: number;
			membershipDeltaId?: string;
			joiningSenderIds?: number[];
		},
	) => {
		if (envelope.type === 'commit-request') {
			sent.push({
				room: roomId,
				target: participantId,
				committerSenderId: envelope.committerSenderId ?? -1,
				epochNumber: envelope.epochNumber ?? 0,
				nextEpochNumber: envelope.nextEpochNumber ?? 0,
				membershipDeltaId: envelope.membershipDeltaId ?? '',
				joiningSenderIds: envelope.joiningSenderIds ?? [],
			});
		}
		originalEmit(roomId, participantId, envelope);
	};

	// -------- Test 1: redesignation after timeout --------
	await (
		relay as unknown as { requestCommitFromHost: Function }
	).requestCommitFromHost('meeting-1', [13], 1);
	assert(
		(sent as { length: number }).length === 1,
		`expected first commit-request immediately, got ${(sent as { length: number }).length}`,
	);
	assert(
		sent[0].committerSenderId === 7,
		`first attempt should target host (7), got ${sent[0].committerSenderId}`,
	);
	assert(
		sent[0].joiningSenderIds.length === 1 && sent[0].joiningSenderIds[0] === 13,
		`first attempt should include joiner [13], got ${JSON.stringify(sent[0].joiningSenderIds)}`,
	);

	// Trigger redesignation directly (avoid waiting COMMITTER_TIMEOUT_MS).
	await (relay as unknown as { redesignate: Function }).redesignate(
		'meeting-1',
		1,
	);
	assert(
		(sent as { length: number }).length === 2,
		`expected second commit-request after redesignate, got ${(sent as { length: number }).length}`,
	);
	const second = sent[1] ?? {};
	assert(
		second.committerSenderId !== sent[0].committerSenderId,
		`second attempt should target a different committer; first=${sent[0].committerSenderId}, second=${second.committerSenderId}`,
	);
	assert(
		second.committerSenderId === 9,
		`second attempt should target oldest non-host (alice, 9), got ${second.committerSenderId}`,
	);

	await (relay as unknown as { redesignate: Function }).redesignate(
		'meeting-1',
		1,
	);
	assert(
		(sent as { length: number }).length === 3,
		`expected third commit-request after second redesignate, got ${(sent as { length: number }).length}`,
	);
	const third = sent[2] ?? {};
	assert(
		third.committerSenderId === 11,
		`third attempt should target bob (11), got ${third.committerSenderId}`,
	);

	await (relay as unknown as { redesignate: Function }).redesignate(
		'meeting-1',
		1,
	);
	assert(
		(sent as { length: number }).length === 3,
		`expected no further commit-requests after MAX_REDESIGNATIONS, got ${(sent as { length: number }).length}`,
	);

	// -------- Test 2: relay commit clears pending --------
	sent.splice(0, sent.length);
	await (
		relay as unknown as { requestCommitFromHost: Function }
	).requestCommitFromHost('meeting-1', [15], 2);
	assert(
		(sent as { length: number }).length === 1,
		`expected one commit-request after fresh request, got ${(sent as { length: number }).length}`,
	);
	const first = sent[0];

	await (relay as unknown as { relayCommit: Function }).relayCommit(
		'meeting-1',
		'host-1',
		7,
		{
			type: 'commit',
			fromParticipantId: 'host-1',
			fromSenderId: 7,
			previousEpochNumber: first.epochNumber,
			epochNumber: first.nextEpochNumber,
			membershipDeltaId: first.membershipDeltaId,
			membershipDeltaHash: 'YWFhYWE=',
			rosterHash: 'YWFhYWE=',
			mlsCommit: Buffer.from([1, 2, 3]).toString('base64'),
		},
	);

	await (relay as unknown as { redesignate: Function }).redesignate(
		'meeting-1',
		first.epochNumber,
	);
	assert(
		(sent as { length: number }).length === 1,
		`expected no further commit-requests after commit cleared pending, got ${(sent as { length: number }).length}`,
	);

	console.log('Committer redesignation tests passed');
}

void main().catch((error) => {
	console.error(error);
	process.exit(1);
});
