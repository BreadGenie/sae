import { computed, type Ref, watch } from "vue";
import { getInitials } from "../utils/text";
import type { PinnedTile } from "./useLayout";

interface ScreenShare {
	consumerId: string;
	participantId: string;
}

interface CurrentUser {
	user_id?: string;
	full_name?: string;
	name?: string;
}

interface ScreenShareTileParticipant {
	user_id: string;
	user_name: string;
	avatar: string;
	initials: string;
	isLocalScreenShare: boolean;
}

interface ScreenShareTile {
	pinId: string;
	participant: ScreenShareTileParticipant;
}

interface MeetingStateLike {
	pinTile: (type: "screenshare", id: string) => void;
	unpinTile: () => void;
}

interface UseScreenShareTilesOptions {
	displayScreenShares: Ref<ScreenShare[]>;
	pinnedTile: Ref<PinnedTile | null>;
	currentUser: Ref<CurrentUser | null | undefined>;
	meetingState: MeetingStateLike;
	getParticipantName: (participantId: string) => string;
}

export function useScreenShareTiles({
	displayScreenShares,
	pinnedTile,
	currentUser,
	meetingState,
	getParticipantName,
}: UseScreenShareTilesOptions) {
	const screenShareSignature = computed(() =>
		displayScreenShares.value.map((share) => share.consumerId).join(","),
	);

	watch(
		screenShareSignature,
		(signature, previousSignature) => {
			const shares = displayScreenShares.value;
			const primaryShareId = shares[0]?.consumerId;

			if (!signature) {
				if (pinnedTile.value?.type === "screenshare") {
					meetingState.unpinTile();
				}
				return;
			}

			const hasNewShare = signature !== previousSignature;
			const shouldAutoPin =
				hasNewShare ||
				!pinnedTile.value ||
				pinnedTile.value.type !== "screenshare" ||
				pinnedTile.value.id !== primaryShareId;

			if (primaryShareId && shouldAutoPin) {
				meetingState.pinTile("screenshare", primaryShareId);
			}
		},
		{ immediate: true },
	);

	const screenShareTiles = computed<ScreenShareTile[]>(() => {
		return displayScreenShares.value.map((share) => {
			const participantName = getParticipantName(share.participantId);
			const isLocalSharer = currentUser.value?.user_id === share.participantId;
			const localName = currentUser.value?.full_name || currentUser.value?.name;
			const displayName = `${
				isLocalSharer ? localName : participantName
			}'s screen`;

			return {
				pinId: share.consumerId,
				participant: {
					user_id: share.participantId,
					user_name: displayName,
					avatar: "",
					initials: getInitials(displayName),
					isLocalScreenShare: isLocalSharer,
				},
			};
		});
	});

	return {
		screenShareTiles,
	};
}
