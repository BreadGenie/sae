// E2EE roster store — in-memory, per-room table of current SFU sockets.
//
// Tier-1 MLS-adjacent state: this holds the SFU's view of "who is currently
// in the room" and "who is online", not the ratchet tree. Path secrets and
// meeting secrets remain client-side; the server is still server-blind on
// MLS internals. See CONTEXT.md "Roster server (tier 1)" for the design.
//
// Responsibilities (slice 1, informational):
//   - track each full-access peer by senderId with isHost + joinedAt
//   - clear on socket disconnect and on room cleanup
//   - expose pickCommitter() for slice 2
//
// Out of scope for slice 1:
//   - validating commits against the roster
//   - reconnect-via-roster (re-adds)
//   - remove-member support
//   - persistence (intentionally memory-only; room lifecycle owns the data)

type RosterEntry = {
	participantId: string;
	senderId: number;
	isHost: boolean;
	joinedAt: number;
};

export class E2eeRosterStore {
	private readonly entriesByRoom = new Map<string, Map<number, RosterEntry>>();

	add(roomId: string, entry: RosterEntry): void {
		let entries = this.entriesByRoom.get(roomId);
		if (!entries) {
			entries = new Map();
			this.entriesByRoom.set(roomId, entries);
		}
		entries.set(entry.senderId, entry);
	}

	remove(roomId: string, senderId: number): void {
		const entries = this.entriesByRoom.get(roomId);
		if (!entries) return;
		entries.delete(senderId);
		if (entries.size === 0) {
			this.entriesByRoom.delete(roomId);
		}
	}

	clearRoom(roomId: string): void {
		this.entriesByRoom.delete(roomId);
	}

	get(roomId: string, senderId: number): RosterEntry | undefined {
		return this.entriesByRoom.get(roomId)?.get(senderId);
	}

	list(roomId: string): RosterEntry[] {
		const entries = this.entriesByRoom.get(roomId);
		if (!entries) return [];
		return Array.from(entries.values());
	}

	/**
	 * Pick a current member to author the next epoch commit, excluding the
	 * joiners. Strategy: prefer host if online; else oldest current member
	 * online; else null (the SFU will retain and rely on retry).
	 */
	pickCommitter(
		roomId: string,
		excludeSenderIds: number[],
	): RosterEntry | null {
		const entries = this.list(roomId);
		const excluded = new Set(excludeSenderIds);
		const eligible = entries.filter((e) => !excluded.has(e.senderId));
		if (eligible.length === 0) return null;
		const host = eligible.find((e) => e.isHost);
		if (host) return host;
		eligible.sort((a, b) => a.joinedAt - b.joinedAt);
		return eligible[0];
	}
}
