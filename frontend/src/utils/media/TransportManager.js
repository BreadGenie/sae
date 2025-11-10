/**
 * Transport Manager
 * Handles mediasoup-client Device and Transport management
 */

import { getSFUClient } from "../sfu-client.js";
import { videoCodecOptions, videoEncodings } from "./encodings.js";

export class TransportManager {
	constructor() {
		this.sendTransport = null;
		this.recvTransport = null;
		this.device = null;
		this.sfuClient = null;
	}

	initialize(sfuClient) {
		this.sfuClient = sfuClient || getSFUClient();
	}

	async initializeDevice() {
		if (this.device) return this.device;
		const { Device } = await import("mediasoup-client");
		this.device = new Device();
		const routerCapsResp = await this.sfuClient.getRouterRtpCapabilities();
		const routerRtpCapabilities =
			routerCapsResp?.rtpCapabilities || routerCapsResp;

		await this.device.load({ routerRtpCapabilities });

		return this.device;
	}

	async createSendTransport() {
		if (this.sendTransport) return this.sendTransport;
		if (!this.device) await this.initializeDevice();
		const rawTransportParams =
			await this.sfuClient.createWebRtcTransport("send");

		this.sendTransport = this.device.createSendTransport({
			id: rawTransportParams.id,
			iceParameters: rawTransportParams.iceParameters,
			iceCandidates: rawTransportParams.iceCandidates,
			dtlsParameters: rawTransportParams.dtlsParameters,
		});
		this.setupSendTransportHandlers();

		return this.sendTransport;
	}

	setupSendTransportHandlers() {
		if (!this.sendTransport) return;
		this.sendTransport.on(
			"connect",
			async ({ dtlsParameters }, callback, errback) => {
				try {
					await this.sfuClient.connectWebRtcTransport(
						this.sendTransport.id,
						dtlsParameters,
					);
					callback();
				} catch (error) {
					errback(error);
				}
			},
		);

		this.sendTransport.on("produce", async (parameters, callback, errback) => {
			try {
				const response = await this.sfuClient.createProducer(
					this.sendTransport.id,
					parameters.rtpParameters,
					parameters.kind,
					parameters.appData,
				);
				callback({ id: response.id });
			} catch (error) {
				errback(error);
			}
		});
	}

	async createReceiveTransport() {
		if (this.recvTransport) return this.recvTransport;
		if (!this.device) await this.initializeDevice();
		const rawTransportParams =
			await this.sfuClient.createWebRtcTransport("recv");

		this.recvTransport = this.device.createRecvTransport({
			id: rawTransportParams.id,
			iceParameters: rawTransportParams.iceParameters,
			iceCandidates: rawTransportParams.iceCandidates,
			dtlsParameters: rawTransportParams.dtlsParameters,
		});
		this.setupReceiveTransportHandlers();
		return this.recvTransport;
	}

	setupReceiveTransportHandlers() {
		if (!this.recvTransport) return;
		this.recvTransport.on(
			"connect",
			async ({ dtlsParameters }, callback, errback) => {
				try {
					await this.sfuClient.connectWebRtcTransport(
						this.recvTransport.id,
						dtlsParameters,
					);
					callback();
				} catch (error) {
					errback(error);
				}
			},
		);

		this.recvTransport.on("connectionstatechange", (state) => {
			if (state === "failed") {
				console.error("❌ Receive transport failed");
			}
		});
	}

	async createProducer(track, appData = {}) {
		if (!this.sendTransport) await this.createSendTransport();
		if (!this.device?.canProduce?.(track?.kind || "video"))
			throw new Error("Unsupported");

		const safeAppData = { type: "camera", ...(appData || {}) };
		try {
			console.log("📡 createProducer called", {
				trackId: track?.id,
				trackKind: track?.kind,
				trackReadyState: track?.readyState,
				appData: safeAppData,
			});
		} catch (_) {}

		const produceOptions = {
			track,
			appData: safeAppData,
		};

		if (track?.kind === "video") {
			produceOptions.encodings = videoEncodings;
			produceOptions.codecOptions = videoCodecOptions;
		}

		const producer = await this.sendTransport.produce(produceOptions);

		return producer;
	}

	async createConsumer(producerId, metadata = {}) {
		if (!this.device) await this.initializeDevice();
		if (!this.recvTransport) await this.createReceiveTransport();

		const rawConsumerParams = await this.sfuClient.createConsumer(
			this.recvTransport.id,
			producerId,
			this.device.rtpCapabilities,
		);

		const isScreen = !!(
			metadata.isScreen ||
			rawConsumerParams.isScreen ||
			rawConsumerParams?.appData?.type === "screen"
		);

		let consumer;
		let firstError = null;
		try {
			const consumeArgs = {
				id: rawConsumerParams.id,
				producerId: rawConsumerParams.producerId,
				kind: rawConsumerParams.kind,
				rtpParameters: rawConsumerParams.rtpParameters,
				...(isScreen ? { appData: { type: "screen" } } : {}),
			};
			consumer = await this.recvTransport.consume(consumeArgs);
		} catch (err) {
			firstError = err;
			throw err;
		}

		if (!consumer && firstError) throw firstError;
		if (isScreen)
			console.info("Screen share consumer created", {
				consumerId: consumer.id,
			});
		return consumer;
	}

	getDeviceCapabilities() {
		return this.device?.rtpCapabilities || null;
	}
	isDeviceLoaded() {
		return this.device?.loaded || false;
	}
	getTransportStats() {
		return {
			sendTransport: {
				id: this.sendTransport?.id || null,
				state: this.sendTransport?.connectionState || "closed",
			},
			recvTransport: {
				id: this.recvTransport?.id || null,
				state: this.recvTransport?.connectionState || "closed",
			},
		};
	}
	cleanup() {
		if (this.sendTransport)
			try {
				this.sendTransport.close();
			} catch (e) {
				/* ignore */
			}
		if (this.recvTransport)
			try {
				this.recvTransport.close();
			} catch (e) {
				/* ignore */
			}
		this.sendTransport = null;
		this.recvTransport = null;
		this.device = null;
	}
}
