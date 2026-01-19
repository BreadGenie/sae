import { computed, onMounted, onUnmounted, ref } from "vue";
import { useResponsiveGrid } from "./useResponsiveGrid";

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
	participants,
	activeSpeakerIds,
	meetingState,
) {
	const { sidebarMaxColumns } = useResponsiveGrid();

	const windowWidth = ref(window.innerWidth || 1280);

	const updateWidth = () => {
		windowWidth.value = window.innerWidth;
	};

	onMounted(() => {
		window.addEventListener("resize", updateWidth);
	});

	onUnmounted(() => {
		window.removeEventListener("resize", updateWidth);
	});

	const maxVisibleTiles = computed(() => {
		const isMobile = windowWidth.value < 768;

		if (isMobile) {
			return 3;
		}

		const cols = sidebarMaxColumns.value;
		const maxRows = 4;
		return cols * maxRows;
	});

	const sidebarDisplay = computed(() => {
		const participantData = participants.value || participants;

		let remotes;
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
			const arrayResult = Array.from(participantData);
			if (
				arrayResult.length > 0 &&
				Array.isArray(arrayResult[0]) &&
				arrayResult[0].length === 2
			) {
				remotes = arrayResult.map(([key, value]) => value);
			} else {
				remotes = arrayResult;
			}
		}
		const total = remotes.length + 1; // include local user
		const threshold = maxVisibleTiles.value;

		if (total <= threshold) {
			return { list: remotes, hidden: [], extra: 0 };
		}

		// Get active speaker IDs
		const activeSpeakers = activeSpeakerIds?.value || [];
		const activeSpeakerSet = new Set(activeSpeakers);
		const raisedHands = meetingState?.raisedHands?.value || {};

		// 1 for local user and 1 for grouped tile
		const remoteCapacity = threshold - 2;

		// Separate participants by video state and active speaker status
		const videoOnActiveSpeakers = remotes.filter(
			(p) => p.video_enabled && activeSpeakerSet.has(p.user_id),
		);
		const videoOnNonSpeakers = remotes.filter(
			(p) => p.video_enabled && !activeSpeakerSet.has(p.user_id),
		);
		const videoOffActiveSpeakers = remotes.filter(
			(p) => !p.video_enabled && activeSpeakerSet.has(p.user_id),
		);
		const raisedHandsParticipants = remotes
			.filter((p) => raisedHands[p.user_id] && !activeSpeakerSet.has(p.user_id))
			.sort((a, b) => {
				const aTime = new Date(raisedHands[a.user_id]).getTime();
				const bTime = new Date(raisedHands[b.user_id]).getTime();
				return aTime - bTime; // Earliest first
			});
		const videoOffNonSpeakers = remotes.filter(
			(p) =>
				!p.video_enabled &&
				!activeSpeakerSet.has(p.user_id) &&
				!raisedHands[p.user_id],
		);

		const visibleRemotes = [];

		// Priority order:
		// 1. Active speakers with video ON
		// 2. Non-active speakers with video ON
		// 3. Active speakers with video OFF (ensure they're visible)
		// 4. Raised hands (sorted by timestamp)
		// 5. Non-active speakers with video OFF

		for (const p of videoOnActiveSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			}
		}

		for (const p of videoOnNonSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			}
		}

		for (const p of videoOffActiveSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			}
		}

		for (const p of raisedHandsParticipants) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			}
		}

		for (const p of videoOffNonSpeakers) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			}
		}

		const visibleIds = new Set(visibleRemotes.map((p) => p.user_id));
		const hidden = remotes.filter((p) => !visibleIds.has(p.user_id));

		return { list: visibleRemotes, hidden, extra: hidden.length };
	});

	const sidebarClass = computed(() => {
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
		const participantCount =
			participantData?.size || Object.keys(participantData).length || 0;
		const total = participantCount + 1;

		let columns = total > 4 ? 2 : 1;
		columns = Math.min(columns, sidebarMaxColumns.value);

		const widthClass = columns === 2 ? "w-72" : "w-64";

		const visible =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);

		const rows = Math.min(4, Math.ceil(visible / columns));

		return `${widthClass} grid-cols-${columns} grid-rows-${rows}`;
	});

	const sidebarStyle = computed(() => {
		const isMobile = windowWidth.value < 768;

		if (isMobile) {
			return {
				display: "grid",
				"grid-auto-rows": "1fr",
				maxHeight: "120px",
			};
		}

		const participantData = participants.value || participants;
		const participantCount =
			participantData?.size || Object.keys(participantData).length || 0;
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

	const singleTileStyle = computed(() => {
		const totalSidebarTiles =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);

		if (totalSidebarTiles === 1) {
			return { minHeight: "25%" };
		}
		return {};
	});

	const visibleTileCount = computed(() => {
		return (
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0)
		);
	});

	const hiddenParticipantsTooltip = computed(() => {
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
		sidebarClass,
		sidebarStyle,
		singleTileStyle,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}
