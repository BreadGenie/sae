import { type ComputedRef, type Ref, computed } from "vue";
import type { Participant } from "../types";
import { useResponsiveGrid } from "./useResponsiveGrid";

interface MeetingState {
	raisedHands?: Ref<Record<string, string>>;
	stableSpeakerIds?: Ref<string[]>;
}

interface DisplayParticipantsResult {
	list: Participant[];
	hidden: Participant[];
	extra: number;
}

interface DisplayParticipant extends Participant {
	isVisible: boolean;
	slotIndex: number;
}

interface GridStyle {
	"grid-auto-rows": string;
	"grid-template-columns": string;
}

interface UseVideoGridLayoutReturn {
	displayParticipants: ComputedRef<DisplayParticipantsResult>;
	allParticipants: ComputedRef<DisplayParticipant[]>;
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
	meetingState: MeetingState,
): UseVideoGridLayoutReturn {
	const { maxColumns, windowWidth, BREAKPOINTS } = useResponsiveGrid();

	const getOptimalColumns = (tileCount: number, maxCols: number): number => {
		const isMobile = windowWidth.value < BREAKPOINTS.sm;

		if (tileCount <= 1) return Math.min(1, maxCols);
		if (tileCount === 2 && isMobile) return 1; // Stack vertically only on mobile for 2 participants
		if (tileCount === 2) return Math.min(2, maxCols); // Side by side on desktop/tablet
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

	// store position in map participant ID -> assigned slot index
	let slotAssignments: Map<string, number> = new Map();

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
		const remoteCapacity = total <= threshold ? remotes.length : threshold - 2;

		// Use stableSpeakerIds for tile ordering (recently stable speakers)
		const stableSpeakers = meetingState.stableSpeakerIds?.value || [];
		const stableSpeakerSet = new Set<string>(stableSpeakers);
		const raisedHands = meetingState?.raisedHands?.value || {};

		const getPriority = (p: Participant) => {
			const isStable = stableSpeakerSet.has(p.user_id);
			const hasVideo = !!p.video_enabled;
			const hasHand = !!raisedHands[p.user_id];

			if (isStable && hasVideo) return 0;
			if (isStable) return 1;
			if (hasVideo) return 2;
			if (hasHand) return 3;
			return 4;
		};

		// priority map
		const priorityMap = new Map<string, number>();
		for (const p of remotes) {
			priorityMap.set(p.user_id, getPriority(p));
		}

		const currentIds = new Set(remotes.map((p) => p.user_id));

		// remove slots for participants who left
		for (const id of slotAssignments.keys()) {
			if (!currentIds.has(id)) {
				slotAssignments.delete(id);
			}
		}

		// get currently visible participants
		const currentlyVisible = new Set<string>();
		for (const [id, slot] of slotAssignments.entries()) {
			if (slot < remoteCapacity) {
				currentlyVisible.add(id);
			}
		}

		// sort all participants by priority, then by existing slot (to avoid needless moving around)
		const sortedByPriority = [...remotes].sort((a, b) => {
			const aPriority = priorityMap.get(a.user_id) ?? 4;
			const bPriority = priorityMap.get(b.user_id) ?? 4;
			if (aPriority !== bPriority) return aPriority - bPriority;

			// Both same priority: prefer already visible
			const aVisible = currentlyVisible.has(a.user_id);
			const bVisible = currentlyVisible.has(b.user_id);
			if (aVisible !== bVisible) return aVisible ? -1 : 1;

			// Both visible or both hidden: keep existing order
			const aSlot = slotAssignments.get(a.user_id) ?? 9999;
			const bSlot = slotAssignments.get(b.user_id) ?? 9999;
			if (aSlot !== bSlot) return aSlot - bSlot;

			return a.user_id.localeCompare(b.user_id);
		});

		// Take top N as visible
		const visibleRemotes = sortedByPriority.slice(0, remoteCapacity);
		const hidden = sortedByPriority.slice(remoteCapacity);

		const usedSlots = new Set<number>();
		const newSlotAssignments = new Map<string, number>();

		// 1. keep existing slots for existing visible participants
		for (const p of visibleRemotes) {
			const existingSlot = slotAssignments.get(p.user_id);
			if (
				existingSlot !== undefined &&
				existingSlot < remoteCapacity &&
				!usedSlots.has(existingSlot)
			) {
				newSlotAssignments.set(p.user_id, existingSlot);
				usedSlots.add(existingSlot);
			}
		}

		// 2. assign free slots to newcomers
		let nextFreeSlot = 0;
		for (const p of visibleRemotes) {
			if (!newSlotAssignments.has(p.user_id)) {
				while (usedSlots.has(nextFreeSlot)) nextFreeSlot++;
				newSlotAssignments.set(p.user_id, nextFreeSlot);
				usedSlots.add(nextFreeSlot);
				nextFreeSlot++;
			}
		}

		slotAssignments = newSlotAssignments;

		// sort by slot
		const orderedVisible = [...visibleRemotes].sort((a, b) => {
			const aSlot = newSlotAssignments.get(a.user_id) ?? 999;
			const bSlot = newSlotAssignments.get(b.user_id) ?? 999;
			return aSlot - bSlot;
		});
		return { list: orderedVisible, hidden, extra: hidden.length };
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

	const allParticipants = computed<DisplayParticipant[]>(() => {
		const dp = displayParticipants.value;

		// map of visible participants to their slot index
		const slotMap = new Map<string, number>();
		dp.list.forEach((p, idx) => slotMap.set(p.user_id, idx));

		const allWithVisibility: DisplayParticipant[] = [];

		// add visible ones first
		for (const p of dp.list) {
			allWithVisibility.push({
				...p,
				isVisible: true,
				slotIndex: slotMap.get(p.user_id) ?? 999,
			});
		}

		// then hidden ones
		for (const p of dp.hidden) {
			allWithVisibility.push({
				...p,
				isVisible: false,
				slotIndex: 999,
			});
		}

		return allWithVisibility;
	});

	return {
		displayParticipants,
		allParticipants,
		gridClass,
		gridStyle,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}
