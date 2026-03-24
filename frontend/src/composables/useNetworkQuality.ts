import { onMounted, onUnmounted, ref } from "vue";
import { getSFUMeetingManager } from "../utils/sfu-meeting-manager.js";

type NetworkQuality = "good" | "poor" | "critical";

export interface NetworkStats {
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

	const updateQuality = (stats: NetworkStats) => {
		if (!stats.isValid) {
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

		try {
			isPolling.value = true;
			const sfuManager = getSFUMeetingManager();
			const transportManager = sfuManager?.transportManager;

			if (transportManager) {
				// check for transport failure initially
				const tStats = transportManager.getTransportStats();
				const sendState = tStats?.sendTransport?.state;
				const recvState = tStats?.recvTransport?.state;

				const isFailed =
					["failed", "disconnected"].includes(sendState) ||
					["failed", "disconnected"].includes(recvState);

				if (isFailed) {
					networkQuality.value = "critical";
					return;
				}

				if (transportManager.getNetworkStats) {
					const stats = await transportManager.getNetworkStats();
					updateQuality(stats);
				}
			}
		} catch (error) {
			console.warn("Failed to poll SFU network stats:", error);
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
