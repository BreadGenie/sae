import { type ComputedRef, computed, type Ref, ref } from "vue";
import { useCurrentUser } from "./useCurrentUser";
import type { MediaState, ScreenShareConsumer } from "./useMediaState";

export interface PinnedTile {
	type: "screenshare" | "participant";
	id: string;
}

export interface GridLayout {
	pinnedTile: Ref<PinnedTile | null>;
	displayScreenShares: ComputedRef<ScreenShareConsumer[]>;
	pinTile: (type: PinnedTile["type"], id: string) => void;
	unpinTile: () => void;
	resetGridLayout: () => void;
}

let instance: GridLayout | null = null;

export function useGridLayout(mediaState?: MediaState): GridLayout {
	if (instance) return instance;

	const pinnedTile = ref<PinnedTile | null>(null);

	const displayScreenShares = computed<ScreenShareConsumer[]>(() => {
		if (!mediaState) return [];

		const shares: ScreenShareConsumer[] = [];

		for (const share of mediaState.activeScreenShareConsumers.value) {
			shares.push(share);
		}

		const currentUserStore = useCurrentUser();
		if (
			mediaState.isScreenSharing.value &&
			(currentUserStore.currentUser.value as Record<string, unknown>)?.user_id
		) {
			shares.push({
				participantId: (
					currentUserStore.currentUser.value as Record<string, unknown>
				)?.user_id as string,
				consumerId: "local-screen",
				local: true,
				startedAt: mediaState.localScreenShareStartedAt.value || 0,
			});
		}

		return shares.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
	});

	const pinTile = (type: PinnedTile["type"], id: string) => {
		pinnedTile.value = { type, id };
	};

	const unpinTile = () => {
		pinnedTile.value = null;
	};

	const resetGridLayout = () => {
		pinnedTile.value = null;
	};

	instance = {
		pinnedTile,
		displayScreenShares,
		pinTile,
		unpinTile,
		resetGridLayout,
	};

	return instance;
}
