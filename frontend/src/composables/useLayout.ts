import { type ComputedRef, type Ref, computed } from "vue";
import type { Participant } from "../types";
import { useResponsiveGrid } from "./useResponsiveGrid";

interface MeetingState {
	raisedHands?: Ref<Record<string, string>>;
	activeSpeakerIds?: Ref<string[]>;
	stableSpeakerIds?: Ref<string[]>;
}

export interface PinnedTile {
	type: "screenshare" | "participant";
	id: string;
}

interface DisplayParticipantsResult {
	list: Participant[];
	hidden: Participant[];
	extra: number;
}

export interface LayoutParticipant extends Participant {
	isVisible: boolean;
	slotIndex: number;
}

interface ContainerStyle {
	display: string;
	"flex-wrap"?: string;
	"justify-content"?: string;
	"align-content"?: string;
	gap?: string;
	overflow?: string;
	"grid-auto-rows"?: string;
	maxHeight?: string;
}

interface TileStyle {
	width?: string;
	height?: string;
	minWidth?: string;
	minHeight?: string;
	marginBottom?: string;
	[key: string]: string | undefined;
}

export interface UseLayoutReturn {
	mode: ComputedRef<"grid" | "sidebar">;
	containerStyle: ComputedRef<ContainerStyle>;
	containerClass: ComputedRef<string>;
	tileStyle: ComputedRef<TileStyle>;
	displayParticipants: ComputedRef<DisplayParticipantsResult>;
	allParticipants: ComputedRef<LayoutParticipant[]>;
	visibleTileCount: ComputedRef<number>;
	hiddenParticipantsTooltip: ComputedRef<string>;
	maxVisibleTiles: ComputedRef<number>;
}

/**
 * Layout composable for the video grid.
 *
 * Modes:
 *   - "grid"    (no pinnedTile) — full-width flex grid, 2-4 adaptive columns
 *   - "sidebar" (pinnedTile set) — pinned area fills the main space, participants
 *                                  collapse into a compact tile strip
 *
 * When a participant is pinned they are removed from the tile strip so
 * their video stream can be shown exclusively in the pinned area.
 */
export function useLayout(
	participants: Ref<Record<string, Participant>>,
	pinnedTile: Ref<PinnedTile | null>,
	meetingState: MeetingState,
	extraTiles: Ref<number>,
): UseLayoutReturn {
	const { maxColumns, sidebarMaxColumns, windowWidth, BREAKPOINTS } =
		useResponsiveGrid();

	const mode = computed<"grid" | "sidebar">(() =>
		pinnedTile.value ? "sidebar" : "grid",
	);

	const isMobile = computed(() => windowWidth.value < BREAKPOINTS.md);

	// ── Participants visible in the tile strip ────────────────────────────────
	// When a remote participant is pinned they are excluded from the strip so
	// their video can be shown in the pinned area without duplication.
	const stripParticipants = computed<Record<string, Participant>>(() => {
		if (pinnedTile.value?.type !== "participant") return participants.value;
		const { [pinnedTile.value.id]: _removed, ...rest } = participants.value;
		return rest;
	});

	// ── Column helpers (grid mode) ────────────────────────────────────────────

	/**
	 * Number of columns = ceil(sqrt(n)), capped at maxCols.
	 *
	 * This gives a naturally square grid that grows its column count only
	 * when it becomes more square to do so:
	 *   n=1→1  n=2-4→2  n=5-9→3  n=10-16→4
	 *
	 * All rows are full (cols tiles) except the last row which holds the
	 * remainder. Natural flex wrapping handles the layout — no break divs
	 * are needed because tile width = (100% - (cols-1)*gap) / cols causes
	 * the container to wrap at exactly cols tiles per row.
	 */
	const getGridColumns = (tileCount: number, maxCols: number): number => {
		if (tileCount <= 0) return 1;
		return Math.min(maxCols, Math.ceil(Math.sqrt(tileCount)));
	};

	const getRowDistribution = (
		totalTiles: number,
		maxCols: number,
	): number[] => {
		if (totalTiles <= 0) return [];
		const cols = getGridColumns(totalTiles, maxCols);
		const rows = Math.ceil(totalTiles / cols);
		const remainder = totalTiles % cols;
		return Array.from({ length: rows }, (_, i) =>
			i < rows - 1 || remainder === 0 ? cols : remainder,
		);
	};

	// ── Max visible tiles ─────────────────────────────────────────────────────

	const maxVisibleTiles = computed<number>(() => {
		if (mode.value === "sidebar") {
			if (isMobile.value) return 3;
			return sidebarMaxColumns.value * 4;
		}
		return maxColumns.value * 4;
	});

	// ── Slot persistence ──────────────────────────────────────────────────────
	// Stable slot assignments keep tiles from jumping around when priority changes.

	let slotAssignments: Map<string, number> = new Map();

	// ── Priority ──────────────────────────────────────────────────────────────

	const getPriority = (
		p: Participant,
		activeSpeakerSet: Set<string>,
		stableSpeakerSet: Set<string>,
		raisedHands: Record<string, string>,
	): number => {
		const isActive = activeSpeakerSet.has(p.user_id);
		const isStable = stableSpeakerSet.has(p.user_id);
		const hasVideo = !!p.video_enabled;
		const hasHand = !!raisedHands[p.user_id];
		if (isActive && hasVideo) return 0;
		if (isActive) return 1;
		if (isStable && hasVideo) return 0;
		if (isStable) return 2;
		if (hasVideo) return 3;
		if (hasHand) return 4;
		return 5;
	};

	// ── Display participants ──────────────────────────────────────────────────

	const displayParticipants = computed<DisplayParticipantsResult>(() => {
		const remotes = Object.values(stripParticipants.value || {});
		// +1 for local user, +extraTiles for non-participant tiles (e.g. unpinned screen share)
		const reserved = 1 + extraTiles.value;
		const total = remotes.length + reserved;
		const threshold = maxVisibleTiles.value;
		const remoteCapacity =
			total <= threshold
				? remotes.length
				: Math.max(0, threshold - reserved - 1);

		const stableSpeakers = meetingState.stableSpeakerIds?.value || [];
		const activeSpeakers = meetingState.activeSpeakerIds?.value || [];
		const activeSpeakerSet = new Set<string>(activeSpeakers);
		const stableSpeakerSet = new Set<string>(stableSpeakers);
		const raisedHands = meetingState?.raisedHands?.value || {};

		const priorityMap = new Map<string, number>();
		for (const p of remotes) {
			priorityMap.set(
				p.user_id,
				getPriority(p, activeSpeakerSet, stableSpeakerSet, raisedHands),
			);
		}

		const currentIds = new Set(remotes.map((p) => p.user_id));
		for (const id of slotAssignments.keys()) {
			if (!currentIds.has(id)) slotAssignments.delete(id);
		}

		const currentlyVisible = new Set<string>();
		for (const [id, slot] of slotAssignments.entries()) {
			if (slot < remoteCapacity) currentlyVisible.add(id);
		}

		const sortedByPriority = [...remotes].sort((a, b) => {
			const aPriority = priorityMap.get(a.user_id) ?? 4;
			const bPriority = priorityMap.get(b.user_id) ?? 4;
			if (aPriority !== bPriority) return aPriority - bPriority;
			const aVisible = currentlyVisible.has(a.user_id);
			const bVisible = currentlyVisible.has(b.user_id);
			if (aVisible !== bVisible) return aVisible ? -1 : 1;
			const aSlot = slotAssignments.get(a.user_id) ?? 9999;
			const bSlot = slotAssignments.get(b.user_id) ?? 9999;
			if (aSlot !== bSlot) return aSlot - bSlot;
			return a.user_id.localeCompare(b.user_id);
		});

		const visibleRemotes = sortedByPriority.slice(0, remoteCapacity);
		const hidden = sortedByPriority.slice(remoteCapacity);

		const usedSlots = new Set<number>();
		const newSlotAssignments = new Map<string, number>();

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

		const orderedVisible = [...visibleRemotes].sort((a, b) => {
			const aSlot = newSlotAssignments.get(a.user_id) ?? 999;
			const bSlot = newSlotAssignments.get(b.user_id) ?? 999;
			return aSlot - bSlot;
		});

		return { list: orderedVisible, hidden, extra: hidden.length };
	});

	const visibleTileCount = computed<number>(
		() =>
			1 +
			extraTiles.value +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0),
	);

	// ── Grid mode layout ──────────────────────────────────────────────────────

	const gridTileStyle = computed<TileStyle>(() => {
		const total = visibleTileCount.value;
		const distribution = getRowDistribution(total, maxColumns.value);
		const firstRowCols = distribution[0] || 1;
		const rows = distribution.length || 1;
		// gap is set on the container via CSS gap (not marginBottom) so it only
		// applies between rows — not after the last row. Height formula is exact.
		const gap = "0.5rem";
		return {
			width: `calc((100% - ${firstRowCols - 1} * ${gap}) / ${firstRowCols})`,
			height: `calc((100% - ${rows - 1} * ${gap}) / ${rows})`,
			minWidth: "0",
			minHeight: "0",
		};
	});

	// ── Sidebar mode layout ───────────────────────────────────────────────────

	const sidebarColumns = computed<number>(() => {
		if (isMobile.value) return 1;
		const total = Object.keys(stripParticipants.value || {}).length + 1; // +1 local
		return Math.min(total > 4 ? 2 : 1, sidebarMaxColumns.value);
	});

	const sidebarContainerClass = computed<string>(() => {
		if (isMobile.value) {
			const visible = visibleTileCount.value;
			const cols = Math.min(visible, 3);
			return `w-full grid-cols-${cols} grid-rows-1`;
		}
		const widthClass = sidebarColumns.value === 2 ? "w-72" : "w-64";
		return `${widthClass} grid-cols-${sidebarColumns.value}`;
	});

	const sidebarContainerStyle = computed<ContainerStyle>(() => {
		if (isMobile.value) {
			return { display: "grid", "grid-auto-rows": "1fr", maxHeight: "120px" };
		}

		const visible = visibleTileCount.value;
		const cols = sidebarColumns.value;
		const rows = Math.min(4, Math.ceil(visible / cols));
		const gapTotal = (rows - 1) * 0.5;

		if (cols === 1 && visible <= 4) {
			const perRowBase = `calc((100% - ${visible - 1} * 0.5rem) / ${visible})`;
			return { display: "grid", "grid-auto-rows": `min(25%, ${perRowBase})` };
		}

		return {
			display: "grid",
			"grid-auto-rows":
				rows === 1
					? "min(25%, 1fr)"
					: `min(25%, calc((100% - ${gapTotal}rem) / ${rows}))`,
		};
	});

	// ── Unified outputs ───────────────────────────────────────────────────────

	const containerStyle = computed<ContainerStyle>(() => {
		if (mode.value === "sidebar") return sidebarContainerStyle.value;
		return {
			display: "flex",
			"flex-wrap": "wrap",
			"justify-content": "center",
			"align-content": "start",
			gap: "0.5rem",
			overflow: "hidden",
		};
	});

	const containerClass = computed<string>(() => {
		if (mode.value === "sidebar") return sidebarContainerClass.value;
		return "call-grid";
	});

	// In sidebar mode tiles fill their CSS grid cells so no explicit sizing needed.
	const tileStyle = computed<TileStyle>(() => {
		if (mode.value === "sidebar") return {};
		return gridTileStyle.value;
	});

	const allParticipants = computed<LayoutParticipant[]>(() => {
		const { list, hidden } = displayParticipants.value;

		const visible: LayoutParticipant[] = list.map((p, idx) => ({
			...p,
			isVisible: true,
			slotIndex: idx,
		}));

		const invisible: LayoutParticipant[] = hidden.map((p, idx) => ({
			...p,
			isVisible: false,
			slotIndex: list.length + idx,
		}));

		return [...visible, ...invisible];
	});

	const hiddenParticipantsTooltip = computed<string>(() => {
		const hidden = displayParticipants.value.hidden || [];
		if (!hidden.length) return "";
		const names = hidden.map((p) => p.user_name || p.user_id);
		const shown = names.slice(0, 8);
		const remaining = names.length - shown.length;
		if (remaining > 0) return `${shown.join(", ")} and ${remaining} more`;
		if (shown.length === 1) return shown[0];
		if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
		return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
	});

	return {
		mode,
		containerStyle,
		containerClass,
		tileStyle,
		displayParticipants,
		allParticipants,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}
