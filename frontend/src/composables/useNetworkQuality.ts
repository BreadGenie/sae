import { inject, onMounted, onUnmounted, type Ref, ref } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";

type NetworkQuality = "good" | "poor" | "critical";

interface NetworkStats {
	rtt: number;
	packetLoss: number;
	availableOutgoingBitrate: number;
	timestamp: number;
	isValid: boolean;
}

export function useNetworkQuality() {
	const networkQuality = ref<NetworkQuality>("good");
	const isPolling = ref(false);
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	const pollIntervalMs = 3000;
	const sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager");
	const sfuManager = sfuManagerRef?.value;

	const updateQuality = (stats: NetworkStats) => {
		if (!stats.isValid) {
			// If we can't get valid stats, assume network is good
			networkQuality.value = "good";
			return;
		}

		// Threshold
		// critical: rtt > 600ms or packet loss > 15%
		const isCritical = stats.rtt > 600 || stats.packetLoss > 15;
		// poor: rtt > 300ms or packet loss > 5%
		const isPoor = stats.rtt > 300 || stats.packetLoss > 5;

		if (isCritical) {
			networkQuality.value = "critical";
		} else if (isPoor) {
			networkQuality.value = "poor";
		} else {
			networkQuality.value = "good";
		}
	};

	const pollStats = async () => {
		if (isPolling.value) return;

		isPolling.value = true;
		try {
			const transportManager = sfuManager?.transportManager;

			if (!transportManager) {
				networkQuality.value = "good";
				return;
			}

			// check for transport failure initially
			const tStats = transportManager.getTransportStats();
			const sendState = tStats?.sendTransport?.state;
			const recvState = tStats?.recvTransport?.state;

			// Local quality should primarily reflect uplink health.
			// recv can be disconnected while local publishing still works.
			const sendFailed = ["failed", "disconnected"].includes(sendState);
			const recvFailed = recvState === "failed";
			const isFailed = sendFailed || recvFailed;

			if (isFailed) {
				networkQuality.value = "critical";
				return;
			}

			if (transportManager.getNetworkStats) {
				const stats = await transportManager.getNetworkStats();
				updateQuality(stats);
			}
		} finally {
			isPolling.value = false;
		}
	};

	onMounted(() => {
		pollInterval = setInterval(pollStats, pollIntervalMs);
	});

	onUnmounted(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	});

	return {
		networkQuality,
	};
}
