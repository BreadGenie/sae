import { computed } from "vue";

/**
 * Composable for managing video grid layout logic
 * Handles participant display, grid sizing, and overflow grouping
 */
export function useVideoGridLayout(participants) {
	// Logic: cap visible tiles at 16 (4x4); extra participants are grouped
	const displayParticipants = computed(() => {
		const src =
			participants && participants.value !== undefined
				? participants.value
				: participants;
		let remotes = [];

		if (typeof src === "object" && src !== null && !Array.isArray(src)) {
			remotes = Object.values(src);
		} else if (Array.isArray(src)) {
			remotes = src;
		} else {
			remotes = [];
		}

		const total = remotes.length + 1;
		const threshold = 16;

		if (total <= threshold) {
			return { list: remotes, hidden: [], extra: 0 };
		}

		const remoteCapacity = 14;
		const videoOn = remotes.filter((p) => p.video_enabled);
		const videoOff = remotes.filter((p) => !p.video_enabled);
		const visibleRemotes = [];

		// Fill video-on participants first
		for (const p of videoOn) {
			if (visibleRemotes.length < remoteCapacity) {
				visibleRemotes.push(p);
			} else {
				break;
			}
		}

		// If capacity not filled, add video-off participants
		if (visibleRemotes.length < remoteCapacity) {
			for (const p of videoOff) {
				if (visibleRemotes.length < remoteCapacity) {
					visibleRemotes.push(p);
				} else {
					break;
				}
			}
		}

		// Hidden are all remaining not in visibleRemotes
		const visibleIds = new Set(visibleRemotes.map((p) => p.user_id));
		const hidden = remotes.filter((p) => !visibleIds.has(p.user_id));

		return { list: visibleRemotes, hidden, extra: hidden.length };
	});

	// Calculate grid columns based on total visible tiles
	const gridClass = computed(() => {
		const totalVisibleTiles =
			1 + // local
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0); // grouped tile if present

		let cols;
		if (totalVisibleTiles <= 1) cols = 1;
		else if (totalVisibleTiles === 2) cols = 2;
		else if (totalVisibleTiles <= 4)
			cols = 2; // 2x2
		else if (totalVisibleTiles <= 9)
			cols = 3; // up to 3x3
		else cols = 4; // 4 columns for 10+ (capped at 4x4 with grouping)

		return `grid-cols-${cols}`;
	});

	// Calculate grid style for equal row heights
	const gridStyle = computed(() => {
		const totalVisibleTiles =
			1 +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0);

		let cols;
		if (totalVisibleTiles <= 1) cols = 1;
		else if (totalVisibleTiles === 2) cols = 2;
		else if (totalVisibleTiles <= 4) cols = 2;
		else if (totalVisibleTiles <= 9) cols = 3;
		else cols = 4;

		return {
			"grid-auto-rows": "1fr",
			"grid-template-columns": `repeat(${cols}, minmax(0, 1fr))`,
		};
	});

	// Total visible tile count for avatar sizing
	const visibleTileCount = computed(() => {
		return (
			1 +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0)
		);
	});

	const hiddenParticipantsTooltip = computed(() => {
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
	};
}
