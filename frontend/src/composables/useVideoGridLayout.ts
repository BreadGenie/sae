import { type ComputedRef, type Ref, computed } from "vue";
import type { Participant } from "../types";
import { useResponsiveGrid } from "./useResponsiveGrid";

interface MeetingState {
	raisedHands?: Ref<Record<string, string>>;
}

interface DisplayParticipantsResult {
	list: Participant[];
	hidden: Participant[];
	extra: number;
}

interface GridStyle {
	"grid-auto-rows": string;
	"grid-template-columns": string;
}

interface UseVideoGridLayoutReturn {
	displayParticipants: ComputedRef<DisplayParticipantsResult>;
	gridClass: ComputedRef<string>;
	gridStyle: ComputedRef<GridStyle>;
	visibleTileCount: ComputedRef<number>;
	hiddenParticipantsTooltip: ComputedRef<string>;
	maxVisibleTiles: ComputedRef<number>;
}

/**
 * Composable for managing video grid layout logic
 * Handles participant display, grid sizing, and overflow grouping
 *
 * Layout rules:
 * - Maximum 4 rows at any screen size
 * - Columns adapt to screen size (2 mobile, 3 tablet, 4 desktop)
 * - Overflow participants go to grouped tile
 */
export function useVideoGridLayout(
	participants: Ref<Record<string, Participant>>,
	activeSpeakerIds: Ref<string[]>,
	meetingState: MeetingState,
): UseVideoGridLayoutReturn {
	const { maxColumns } = useResponsiveGrid();

	const getOptimalColumns = (tileCount: number, maxCols: number): number => {
		if (tileCount <= 1) return Math.min(1, maxCols);
		if (tileCount === 2) return Math.min(2, maxCols);
		if (tileCount <= 4) return Math.min(2, maxCols); // 2x2
		if (tileCount <= 6) return Math.min(3, maxCols); // up to 2x3
		if (tileCount <= 9) return Math.min(3, maxCols); // up to 3x3
		if (tileCount <= 12) return Math.min(4, maxCols); // up to 3x4
		return Math.min(4, maxCols); // 4x4 max
	};

	const maxVisibleTiles = computed<number>(() => {
		const cols = maxColumns.value;
		const maxRows = 4;
		return cols * maxRows; // e.g., 2 cols = 8 tiles, 3 cols = 12, 4 cols = 16
	});

	// cap visible tiles based on screen size (cols × 4 rows)
	// extra participants are grouped
	const displayParticipants = computed<DisplayParticipantsResult>(() => {
		let remotes: Participant[] = [];

		if (participants.value) {
			remotes = Object.values(participants.value);
		} else {
			remotes = [];
		}

		const total = remotes.length + 1; // +1 for local user
		const threshold = maxVisibleTiles.value;

		// Get active speaker IDs
		const activeSpeakers = activeSpeakerIds?.value || [];
		const activeSpeakerSet = new Set<string>(activeSpeakers);
		const raisedHands = meetingState?.raisedHands?.value || {};

		// If within threshold, show all
		if (total <= threshold) {
			return { list: remotes, hidden: [], extra: 0 };
		}

		// 1 for local user and 1 for grouped tile
		const remoteCapacity = threshold - 2;

		// Separate participants by video state and active speaker status
		// Sort by user_id for stable ordering within each category
		const videoOnActiveSpeakers = remotes
			.filter((p) => p.video_enabled && activeSpeakerSet.has(p.user_id))
			.sort((a, b) => a.user_id.localeCompare(b.user_id));
		const videoOnNonSpeakers = remotes
			.filter((p) => p.video_enabled && !activeSpeakerSet.has(p.user_id))
			.sort((a, b) => a.user_id.localeCompare(b.user_id));
		const videoOffActiveSpeakers = remotes
			.filter((p) => !p.video_enabled && activeSpeakerSet.has(p.user_id))
			.sort((a, b) => a.user_id.localeCompare(b.user_id));
		const raisedHandsParticipants = remotes
			.filter((p) => raisedHands[p.user_id] && !activeSpeakerSet.has(p.user_id))
			.sort((a, b) => {
				const aTime = new Date(raisedHands[a.user_id]).getTime();
				const bTime = new Date(raisedHands[b.user_id]).getTime();
				// First sort by timestamp (earliest first), then by user_id for stability
				if (aTime !== bTime) {
					return aTime - bTime;
				}
				return a.user_id.localeCompare(b.user_id);
			});
		const videoOffNonSpeakers = remotes
			.filter(
				(p) =>
					!p.video_enabled &&
					!activeSpeakerSet.has(p.user_id) &&
					!raisedHands[p.user_id],
			)
			.sort((a, b) => a.user_id.localeCompare(b.user_id));

		const visibleRemotes: Participant[] = [];

		// Priority order:
		// 1. Active speakers with video ON
		// 2. Non-active speakers with video ON
		// 3. Active speakers with video OFF (ensure they're visible)
		// 4. Raised hands
		// 5. Non-active speakers with video OFF

		for (const p of videoOnActiveSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		for (const p of videoOnNonSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		for (const p of videoOffActiveSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		for (const p of raisedHandsParticipants) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		for (const p of videoOffNonSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		// Hidden are all remaining not in visibleRemotes
		const visibleIds = new Set(visibleRemotes.map((p) => p.user_id));
		const hidden = remotes.filter((p) => !visibleIds.has(p.user_id));

		return { list: visibleRemotes, hidden, extra: hidden.length };
	});

	// Calculate grid columns based on total visible tiles and screen size
	const gridClass = computed<string>(() => {
		const totalVisibleTiles =
			1 + // local
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0); // grouped tile if present

		const cols = getOptimalColumns(totalVisibleTiles, maxColumns.value);

		return `grid-cols-${cols}`;
	});

	// Calculate grid style for equal row heights
	const gridStyle = computed<GridStyle>(() => {
		const totalVisibleTiles =
			1 +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0);

		const cols = getOptimalColumns(totalVisibleTiles, maxColumns.value);

		return {
			"grid-auto-rows": "1fr",
			"grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`,
		};
	});

	// Total visible tile count for avatar sizing
	const visibleTileCount = computed<number>(() => {
		return (
			1 +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0)
		);
	});

	const hiddenParticipantsTooltip = computed<string>(() => {
		const hidden = displayParticipants.value.hidden || [];
		if (!hidden.length) return "";

		const names = hidden.map((p) => p.user_name || p.user_id);
		const shown = names.slice(0, 8);
		const remaining = names.length - shown.length;

		if (remaining > 0) {
			return `${shown.join(", ")} and ${remaining} more`;
		}
		if (shown.length === 1) return shown[0];
		if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;

		return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
	});

	return {
		displayParticipants,
		gridClass,
		gridStyle,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}
