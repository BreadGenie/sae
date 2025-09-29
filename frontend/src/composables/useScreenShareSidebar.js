import { computed } from "vue";

/**
 * Composable for managing screen share sidebar layout
 * Handles participant display in sidebar during screen sharing
 */
export function useScreenShareSidebar(participants) {
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

		if (total <= 8) {
			return { list: remotes, hidden: [], extra: 0 };
		}

		// Prioritize participants with video enabled so they are never grouped
		const videoOn = remotes.filter((p) => p.video_enabled);
		const videoOff = remotes.filter((p) => !p.video_enabled);

		const baseCapacity = 6;
		const capacity = Math.max(baseCapacity, videoOn.length);
		const visibleRemotes = [
			...videoOn,
			...videoOff.slice(0, Math.max(0, capacity - videoOn.length)),
		];
		const hidden = videoOff.slice(Math.max(0, capacity - videoOn.length));

		return { list: visibleRemotes, hidden, extra: hidden.length };
	});

	const sidebarClass = computed(() => {
		const participantData = participants.value || participants;
		const participantCount =
			participantData?.size || Object.keys(participantData).length || 0;
		const total = participantCount + 1;
		const base = total > 4 ? "w-72 grid-cols-2" : "w-64 grid-cols-1";

		const visible =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);

		const columns = total > 4 ? 2 : 1;
		const rows = Math.ceil(visible / columns);

		return `${base} grid-rows-${rows}`;
	});

	const sidebarStyle = computed(() => {
		const participantData = participants.value || participants;
		const participantCount =
			participantData?.size || Object.keys(participantData).length || 0;
		const total = participantCount + 1;
		const columns = total > 4 ? 2 : 1;
		const visible =
			1 +
			sidebarDisplay.value.list.length +
			(sidebarDisplay.value.extra > 0 ? 1 : 0);
		const rows = Math.ceil(visible / columns);

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
	};
}
