import {
	type ComputedRef,
	type Ref,
	computed,
	onMounted,
	onUnmounted,
	ref,
	watch,
} from "vue";
import type { Participant } from "../types";
import { useResponsiveGrid } from "./useResponsiveGrid";

interface MeetingState {
	raisedHands?: Ref<Record<string, string>>;
	stableSpeakerIds?: Ref<string[]>;
}

interface SidebarDisplayResult {
	list: Participant[];
	hidden: Participant[];
	extra: number;
}

interface SidebarStyle {
	display: string;
	"grid-auto-rows": string;
	maxHeight?: string;
}

interface SingleTileStyle {
	minHeight?: string;
}

interface UseScreenShareSidebarReturn {
	sidebarDisplay: ComputedRef<SidebarDisplayResult>;
	sidebarClass: ComputedRef<string>;
	sidebarStyle: ComputedRef<SidebarStyle>;
	singleTileStyle: ComputedRef<SingleTileStyle>;
	visibleTileCount: ComputedRef<number>;
	hiddenParticipantsTooltip: ComputedRef<string>;
	maxVisibleTiles: ComputedRef<number>;
	allParticipants: ComputedRef<SidebarParticipant[]>;
}

/**
 * Composable for managing screen share sidebar layout
 * Handles participant display in sidebar during screen sharing
 *
 * Layout rules:
 * - Mobile (<768px): Max 3 tiles total (horizontal strip)
 * - Tablet/Desktop: Maximum 4 rows, 1-2 columns
 * - Overflow participants go to grouped tile
 */
export function useScreenShareSidebar(
	participants: Ref<Record<string, Participant>>,
	speakerIds: Ref<string[]>,
	meetingState: MeetingState,
): UseScreenShareSidebarReturn {
	const { sidebarMaxColumns } = useResponsiveGrid();

	const windowWidth = ref<number>(window.innerWidth || 1280);

	const updateWidth = (): void => {
		windowWidth.value = window.innerWidth;
	};

	onMounted(() => {
		window.addEventListener("resize", updateWidth);
	});

	onUnmounted(() => {
		window.removeEventListener("resize", updateWidth);
	});

	const maxVisibleTiles = computed<number>(() => {
		const isMobile = windowWidth.value < 768;

		if (isMobile) {
			return 3;
		}

		const cols = sidebarMaxColumns.value;
		const maxRows = 4;
		return cols * maxRows;
	});

	// State for slot persistence (User ID -> Slot Index)
	const slotAssignments = ref(new Map<string, number>());
	const allParticipantsRef = ref<SidebarParticipant[]>([]);
	const sidebarDisplayRef = ref<SidebarDisplayResult>({
		list: [],
		hidden: [],
		extra: 0,
	});

	// Watch triggers layout update
	const updateLayout = () => {
		const participantData = participants.value || participants;

		let remotes: Participant[];
		if (participantData instanceof Map) {
			remotes = Array.from(participantData.values());
		} else if (
			typeof participantData === "object" &&
			!Array.isArray(participantData) &&
			participantData !== null
		) {
			remotes = Object.values(participantData);
		} else if (Array.isArray(participantData)) {
			if (
				participantData.length > 0 &&
				Array.isArray(participantData[0]) &&
				participantData[0].length === 2
			) {
				remotes = participantData.map(([key, value]) => value);
			} else {
				remotes = participantData;
			}
		} else {
			const arrayResult = Array.from(participantData as Iterable<unknown>);
			if (
				arrayResult.length > 0 &&
				Array.isArray(arrayResult[0]) &&
				arrayResult[0].length === 2
			) {
				remotes = arrayResult.map(
					(item) => (item as [unknown, Participant])[1],
				);
			} else {
				remotes = arrayResult as Participant[];
			}
		}

		const threshold = maxVisibleTiles.value;
		const totalTiles = remotes.length + 1; // include local tile
		const remoteCapacity =
			totalTiles <= threshold ? remotes.length : Math.max(0, threshold - 2);

		// Get active speaker IDs
		const activeSpeakers = speakerIds?.value || [];
		const activeSpeakerSet = new Set<string>(activeSpeakers);
		const raisedHands = meetingState?.raisedHands?.value || {};

		// Calculate priority
		const getPriority = (p: Participant) => {
			const isStable = activeSpeakerSet.has(p.user_id);
			const hasVideo = !!p.video_enabled;
			const hasHand = !!raisedHands[p.user_id];

			if (isStable && hasVideo) return 0;
			if (isStable) return 1;
			if (hasHand) return 2;
			if (hasVideo) return 3;
			return 4;
		};

		// 1. sort remotes by priority to find candidates
		const priorityMap = new Map<string, number>();
		for (const p of remotes) {
			priorityMap.set(p.user_id, getPriority(p));
		}

		const sortedByPriority = [...remotes].sort((a, b) => {
			const pA = priorityMap.get(a.user_id) ?? 4;
			const pB = priorityMap.get(b.user_id) ?? 4;
			if (pA !== pB) return pA - pB;
			return a.user_id.localeCompare(b.user_id);
		});

		// candidates are the top visible participants
		const candidates = sortedByPriority.slice(0, remoteCapacity);

		const hidden = sortedByPriority.slice(remoteCapacity);

		// 2. Assign Slots
		const newSlots = new Map<string, number>();
		const slotsTaken = new Set<number>();

		// 1. keep existing slots for candidates
		for (const p of candidates) {
			if (slotAssignments.value.has(p.user_id)) {
				const oldSlot = slotAssignments.value.get(p.user_id);
				if (
					oldSlot !== undefined &&
					oldSlot < remoteCapacity &&
					!slotsTaken.has(oldSlot)
				) {
					newSlots.set(p.user_id, oldSlot);
					slotsTaken.add(oldSlot);
				}
			}
		}

		// 2. assign free slots to newcomers
		let nextFreeSlot = 0;
		for (const p of candidates) {
			if (!newSlots.has(p.user_id)) {
				while (slotsTaken.has(nextFreeSlot) && nextFreeSlot < remoteCapacity) {
					nextFreeSlot++;
				}
				if (nextFreeSlot < remoteCapacity) {
					newSlots.set(p.user_id, nextFreeSlot);
					slotsTaken.add(nextFreeSlot);
				}
			}
		}

		slotAssignments.value = newSlots;

		// visible list must be sorted by slot index for stable grid layout
		const visibleList: Participant[] = [];
		const visibleMap = new Map<string, Participant>();
		for (const p of candidates) {
			if (newSlots.has(p.user_id)) {
				visibleMap.set(p.user_id, p);
			}
		}

		for (let i = 0; i < remoteCapacity; i++) {
			for (const [uid, slot] of newSlots.entries()) {
				if (slot === i && visibleMap.has(uid)) {
					const participant = visibleMap.get(uid);
					if (participant) {
						visibleList.push(participant);
					}
					break;
				}
			}
		}

		sidebarDisplayRef.value = {
			list: visibleList,
			hidden: hidden,
			extra: hidden.length,
		};

		const combined: SidebarParticipant[] = [];
		for (const p of visibleList) {
			combined.push({ ...p, isVisible: true });
		}
		for (const p of hidden) {
			combined.push({ ...p, isVisible: false });
		}
		allParticipantsRef.value = combined;
	};

	watch(
		[
			() => participants.value,
			speakerIds,
			maxVisibleTiles,
			() => meetingState.raisedHands?.value,
		],
		updateLayout,
		{ deep: true, immediate: true },
	);

	const sidebarDisplay = computed(() => sidebarDisplayRef.value);
	const allParticipants = computed(() => allParticipantsRef.value);

	const sidebarClass = computed<string>(() => {
		const isMobile = windowWidth.value < 768;

		if (isMobile) {
			// horizontal strip with 3 columns max
			const visible =
				1 +
				sidebarDisplay.value.list.length +
				(sidebarDisplay.value.extra > 0 ? 1 : 0);
			const cols = Math.min(visible, 3);
			return `w-full grid-cols-${cols} grid-rows-1`;
		}

		// vertical sidebar for desktop/tablet
		const participantData = participants.value || participants;
		const participantCount: number =
			participantData instanceof Map
				? participantData.size
				: Object.keys(participantData as Record<string, Participant>).length;
		const total = participantCount + 1;

		let columns = total > 4 ? 2 : 1;
		columns = Math.min(columns, sidebarMaxColumns.value);

		const widthClass = columns === 2 ? "w-72" : "w-64";

		return `${widthClass} grid-cols-${columns}`;
	});

	const sidebarStyle = computed<SidebarStyle>(() => {
		const isMobile = windowWidth.value < 768;

		if (isMobile) {
			return {
				display: "grid",
				"grid-auto-rows": "1fr",
				maxHeight: "120px",
			};
		}

		const participantData = participants.value || participants;
		const participantCount: number =
			participantData instanceof Map
				? participantData.size
				: Object.keys(participantData as Record<string, Participant>).length;
		const total = participantCount + 1;

		let columns = total > 4 ? 2 : 1;
		columns = Math.min(columns, sidebarMaxColumns.value);

		const visible =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);

		const rows = Math.min(4, Math.ceil(visible / columns));

		// subtract total vertical gaps (rows-1)*0.5rem (gap-2 = 0.5rem) from 100%
		const gapRem = 0.5;
		const gapTotal = (rows - 1) * gapRem;

		// if only 2/3 users cap it to 25%
		if (columns === 1 && visible <= 4) {
			const perRowBase = `calc((100% - ${(visible - 1).toString()} * 0.5rem) / ${visible})`;
			const perRow = `min(25%, ${perRowBase})`;
			return { display: "grid", "grid-auto-rows": perRow };
		}

		return {
			display: "grid",
			"grid-auto-rows":
				rows === 1
					? "min(25%, 1fr)"
					: `min(25%, calc((100% - ${gapTotal}rem) / ${rows}))`,
		};
	});

	const singleTileStyle = computed<SingleTileStyle>(() => {
		const totalSidebarTiles =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);

		if (totalSidebarTiles === 1) {
			return { minHeight: "25%" };
		}
		return {};
	});

	const visibleTileCount = computed<number>(() => {
		return (
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0)
		);
	});

	const hiddenParticipantsTooltip = computed<string>(() => {
		const hidden = sidebarDisplay.value.hidden || [];
		if (!hidden.length) return "";

		const names = hidden.map((p) => p.user_name || p.user_id);
		const shown = names.slice(0, 5);
		const remaining = names.length - shown.length;

		if (remaining > 0) {
			return `${shown.join(", ")} and ${remaining} more`;
		}
		if (shown.length === 1) return shown[0];
		if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;

		return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
	});

	return {
		sidebarDisplay,
		allParticipants,
		sidebarClass,
		sidebarStyle,
		singleTileStyle,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}

export interface SidebarParticipant extends Participant {
	isVisible: boolean;
}
