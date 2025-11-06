import { onMounted, onUnmounted, ref } from "vue";

/**
 * Network connection information from navigator
 */
export interface NetworkConnectionInfo {
	effectiveType: string; // 'slow-2g', '2g', '3g', '4g'
	downlink: number; // Mbps
	rtt: number; // ms
	saveData: boolean;
}

/**
 * Navigator connection API interface
 */
interface NavigatorConnection extends EventTarget {
	effectiveType: string;
	downlink: number;
	rtt: number;
	saveData: boolean;
	addEventListener(type: "change", listener: () => void): void;
	removeEventListener(type: "change", listener: () => void): void;
}

declare global {
	interface Navigator {
		connection?: NavigatorConnection;
		mozConnection?: NavigatorConnection;
		webkitConnection?: NavigatorConnection;
	}
}

/**
 * Composable for monitoring client-side network quality
 */
export function useNetworkQuality() {
	const networkConnectionInfo = ref<NetworkConnectionInfo | null>(null);

	/**
	 * Get current network connection information from navigator
	 */
	const getNetworkConnectionInfo = (): NetworkConnectionInfo | null => {
		const connection =
			navigator.connection ||
			navigator.mozConnection ||
			navigator.webkitConnection;
		if (!connection) return null;

		return {
			effectiveType: connection.effectiveType, // 'slow-2g', '2g', '3g', '4g'
			downlink: connection.downlink, // Mbps
			rtt: connection.rtt, // ms
			saveData: connection.saveData,
		};
	};

	const updateConnectionInfo = () => {
		networkConnectionInfo.value = getNetworkConnectionInfo();
	};

	onMounted(() => {
		updateConnectionInfo();

		const connection =
			navigator.connection ||
			navigator.mozConnection ||
			navigator.webkitConnection;

		if (connection) {
			connection.addEventListener("change", updateConnectionInfo);
		}

		window.addEventListener("online", updateConnectionInfo);
		window.addEventListener("offline", updateConnectionInfo);
	});

	onUnmounted(() => {
		const connection =
			navigator.connection ||
			navigator.mozConnection ||
			navigator.webkitConnection;

		if (connection) {
			connection.removeEventListener("change", updateConnectionInfo);
		}

		window.removeEventListener("online", updateConnectionInfo);
		window.removeEventListener("offline", updateConnectionInfo);
	});

	return {
		networkConnectionInfo,
		getNetworkConnectionInfo,
	};
}
