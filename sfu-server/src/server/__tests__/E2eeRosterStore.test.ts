// Smoke tests for E2eeRosterStore. Run via:
//   yarn ts-node src/server/__tests__/E2eeRosterStore.test.ts
//
// (sfu-server has no formal test framework; keep these in sync manually.)

import { E2eeRosterStore } from '../E2eeRosterStore';

const roomId = 'meeting-1';

function makeEntry(
	senderId: number,
	opts: { participantId?: string; isHost?: boolean; joinedAt?: number } = {},
) {
	return {
		senderId,
		participantId: opts.participantId ?? `user-${senderId}`,
		isHost: opts.isHost ?? false,
		joinedAt: opts.joinedAt ?? Date.now(),
	};
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

const store = new E2eeRosterStore();

// add + get + list
store.add(roomId, makeEntry(1));
store.add(roomId, makeEntry(2, { isHost: true, joinedAt: 100 }));
store.add(roomId, makeEntry(3, { joinedAt: 200 }));

assert(store.list(roomId).length === 3, 'expected 3 entries');
assert(
	store.get(roomId, 1)?.participantId === 'user-1',
	'expected participantId for sender 1',
);
assert(store.get(roomId, 2)?.isHost === true, 'sender 2 should be host');

// remove
store.remove(roomId, 1);
assert(store.list(roomId).length === 2, 'expected 2 entries after remove');
assert(store.get(roomId, 1) === undefined, 'sender 1 should be gone');

// pickCommitter: host preferred
const pickedHost = store.pickCommitter(roomId, []);
assert(
	pickedHost?.senderId === 2,
	`host should be picked first, got senderId=${pickedHost?.senderId}`,
);

// pickCommitter: skip joiner, fall back to oldest
const pickedNext = store.pickCommitter(roomId, [2]);
assert(
	pickedNext?.senderId === 3,
	`should fall back to non-host; got senderId=${pickedNext?.senderId}`,
);

// pickCommitter: empty
const store2 = new E2eeRosterStore();
assert(
	store2.pickCommitter('empty-room', []) === null,
	'empty room should return null',
);

// clearRoom
store.clearRoom(roomId);
assert(store.list(roomId).length === 0, 'clearRoom should remove all entries');

// remove from non-existent room is a no-op
store.remove('nonexistent', 99);

console.log('E2eeRosterStore tests passed');
