import { nextTick, onUnmounted, type Ref, ref, watch } from "vue";
import type { PinnedTile } from "./useLayout";

interface UsePinnedTileAnimationOptions {
	container: Ref<HTMLElement | null>;
	pinnedPanel: Ref<HTMLElement | null>;
	pinnedTile: Ref<PinnedTile | null>;
	visibleTileCount: Ref<number>;
}

type TileStyle = Record<string, string | number>;

export function usePinnedTileAnimation({
	container,
	pinnedPanel,
	pinnedTile,
	visibleTileCount,
}: UsePinnedTileAnimationOptions) {
	const isFlipAnimating = ref(false);
	const pinnedTileStyle = ref<TileStyle>({});

	let flipCleanupTimer: ReturnType<typeof setTimeout> | null = null;
	let activeAnimations: Animation[] = [];
	let resizeObserver: ResizeObserver | null = null;
	let pinnedStyleRaf: number | null = null;
	let deferredPinnedTileMeasurement = false;

	const afterLayout = () =>
		new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});

	const measurePinnedTileStyle = () => {
		if (!pinnedPanel.value || !container.value || !pinnedTile.value) {
			pinnedTileStyle.value = {};
			return;
		}

		const panelRect = pinnedPanel.value.getBoundingClientRect();
		const containerRect = container.value.getBoundingClientRect();
		pinnedTileStyle.value = {
			position: "absolute",
			top: `${panelRect.top - containerRect.top}px`,
			left: `${panelRect.left - containerRect.left}px`,
			width: `${panelRect.width}px`,
			height: `${panelRect.height}px`,
			zIndex: 10,
		};
	};

	const queuePinnedTileMeasurement = () => {
		if (isFlipAnimating.value) {
			deferredPinnedTileMeasurement = true;
			return;
		}
		if (pinnedStyleRaf) cancelAnimationFrame(pinnedStyleRaf);
		pinnedStyleRaf = requestAnimationFrame(() => {
			pinnedStyleRaf = null;
			measurePinnedTileStyle();
		});
	};

	const flushPinnedTileMeasurement = () => {
		if (!deferredPinnedTileMeasurement) return;
		deferredPinnedTileMeasurement = false;
		queuePinnedTileMeasurement();
	};

	const captureAllTileRects = () => {
		const rects = new Map<string, DOMRect>();
		if (!container.value) return rects;

		for (const el of container.value.querySelectorAll("[data-tile-id]")) {
			const id = el.getAttribute("data-tile-id");
			if (!id || el.classList.contains("hidden-tile")) continue;
			rects.set(id, el.getBoundingClientRect());
		}

		return rects;
	};

	const cancelActiveAnimations = () => {
		for (const animation of activeAnimations) {
			try {
				animation.cancel();
			} catch (_) {}
		}
		activeAnimations = [];
	};

	const performFLIP = (oldRects: Map<string, DOMRect>) => {
		if (!container.value) return;

		cancelActiveAnimations();

		const DURATION = 550;
		const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

		for (const el of container.value.querySelectorAll("[data-tile-id]")) {
			const id = el.getAttribute("data-tile-id");
			if (!id || el.classList.contains("hidden-tile")) continue;

			const oldRect = oldRects.get(id);
			const newRect = el.getBoundingClientRect();

			if (!oldRect) {
				activeAnimations.push(
					el.animate(
						[
							{ opacity: 0, transform: "scale(0.9)" },
							{ opacity: 1, transform: "scale(1)" },
						],
						{
							duration: DURATION * 0.6,
							easing: EASING,
							delay: DURATION * 0.2,
						},
					),
				);
				continue;
			}

			const dx = oldRect.left - newRect.left;
			const dy = oldRect.top - newRect.top;
			const sx = oldRect.width / newRect.width;
			const sy = oldRect.height / newRect.height;

			if (
				Math.abs(dx) < 2 &&
				Math.abs(dy) < 2 &&
				Math.abs(sx - 1) < 0.02 &&
				Math.abs(sy - 1) < 0.02
			) {
				continue;
			}

			activeAnimations.push(
				el.animate(
					[
						{
							transformOrigin: "top left",
							transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
						},
						{
							transformOrigin: "top left",
							transform: "translate(0px, 0px) scale(1, 1)",
						},
					],
					{ duration: DURATION, easing: EASING },
				),
			);
		}

		if (activeAnimations.length > 0) {
			Promise.all(
				activeAnimations.map((animation) => animation.finished.catch(() => {})),
			).then(() => {
				activeAnimations = [];
				isFlipAnimating.value = false;
				flushPinnedTileMeasurement();
			});
		} else {
			isFlipAnimating.value = false;
			flushPinnedTileMeasurement();
		}
	};

	watch(
		[pinnedPanel, container, pinnedTile],
		([panelEl, containerEl]) => {
			if (resizeObserver) {
				resizeObserver.disconnect();
				resizeObserver = null;
			}

			queuePinnedTileMeasurement();

			if (panelEl || containerEl) {
				resizeObserver = new ResizeObserver(() => {
					queuePinnedTileMeasurement();
				});
				if (panelEl) resizeObserver.observe(panelEl);
				if (containerEl && containerEl !== panelEl) {
					resizeObserver.observe(containerEl);
				}
			}
		},
		{ immediate: true },
	);

	watch(visibleTileCount, () => {
		queuePinnedTileMeasurement();
	});

	watch(
		pinnedTile,
		async (nextPinned, prevPinned) => {
			if (!prevPinned && !nextPinned) return;
			if (
				prevPinned?.id === nextPinned?.id &&
				prevPinned?.type === nextPinned?.type
			) {
				return;
			}

			if (flipCleanupTimer) clearTimeout(flipCleanupTimer);
			cancelActiveAnimations();

			isFlipAnimating.value = true;
			const oldRects = captureAllTileRects();

			await nextTick();
			await afterLayout();
			measurePinnedTileStyle();
			await nextTick();
			await afterLayout();

			performFLIP(oldRects);

			flipCleanupTimer = setTimeout(() => {
				isFlipAnimating.value = false;
				flushPinnedTileMeasurement();
			}, 700);
		},
		{ flush: "pre" },
	);

	onUnmounted(() => {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (pinnedStyleRaf) {
			cancelAnimationFrame(pinnedStyleRaf);
			pinnedStyleRaf = null;
		}
		if (flipCleanupTimer) {
			clearTimeout(flipCleanupTimer);
			flipCleanupTimer = null;
		}
		cancelActiveAnimations();
	});

	return {
		isFlipAnimating,
		pinnedTileStyle,
	};
}
