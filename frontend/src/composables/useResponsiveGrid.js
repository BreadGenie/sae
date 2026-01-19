import { computed, onMounted, onUnmounted, ref } from "vue";

/**
 * Composable for responsive grid layout based on screen width
 * Returns the maximum number of columns allowed for the current viewport
 */
export function useResponsiveGrid() {
	const BREAKPOINTS = {
		sm: 640,
		md: 768,
		lg: 1024,
		xl: 1280,
	};

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

	// Mobile: min 2 columns, Tablet: max 3 columns, Desktop: max 4 columns
	const maxColumns = computed(() => {
		if (windowWidth.value < BREAKPOINTS.sm) {
			return 2;
		}
		if (windowWidth.value < BREAKPOINTS.md) {
			return 2;
		}
		if (windowWidth.value < BREAKPOINTS.lg) {
			return 3;
		}
		return 4;
	});

	// For sidebar during screen share
	// Mobile: max 1 column, Tablet: max 2 columns
	const sidebarMaxColumns = computed(() => {
		if (windowWidth.value < BREAKPOINTS.md) {
			return 1;
		}
		return 2;
	});

	const avatarSizeTier = computed(() => {
		if (windowWidth.value < BREAKPOINTS.sm) {
			return "xs";
		}
		if (windowWidth.value < BREAKPOINTS.md) {
			return "sm";
		}
		if (windowWidth.value < BREAKPOINTS.lg) {
			return "md";
		}
		return "lg";
	});

	return {
		windowWidth,
		maxColumns,
		sidebarMaxColumns,
		avatarSizeTier,
		BREAKPOINTS,
	};
}
