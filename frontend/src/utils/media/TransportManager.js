/**
 * Transport Manager
 * Handles mediasoup-client Device and Transport management
 */

import { getSFUClient } from "../sfu-client.js";
import { resolveCodecStrategy } from "./codecStrategy.ts";
import {
	svcEncodingTemplate,
	videoCodecOptions,
	videoEncodings,
} from "./encodings.js";

export class TransportManager {
	constructor() {
		this.sendTransport = null;
		this.recvTransport = null;
		this.device = null;
		this.sfuClient = null;
		this.routerRtpCapabilities = null;
		this.activeVideoStrategy = "simulcast";
	}

	getVideoEncodingDecision() {
		const preference = this.sfuClient?.getCodecStrategy?.() || "auto";
		return resolveCodecStrategy({
			preference,
			deviceCapabilities: this.device?.rtpCapabilities,
			routerCapabilities: this.routerRtpCapabilities,
		});
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
		this.routerRtpCapabilities = routerRtpCapabilities;

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
					if (this.sendTransport.connectionState === "new") {
						await this.sfuClient.connectWebRtcTransport(
							this.sendTransport.id,
							dtlsParameters,
						);
					}
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
					if (this.recvTransport.connectionState === "new") {
						await this.sfuClient.connectWebRtcTransport(
							this.recvTransport.id,
							dtlsParameters,
						);
					}
					callback();
				} catch (error) {
					errback(error);
				}
			},
		);

		this.recvTransport.on("connectionstatechange", (state) => {
			if (state === "failed") {
				console.error("Receive transport failed");
			}
		});
	}

	async createProducer(track, appData = {}) {
		if (!this.sendTransport) await this.createSendTransport();
		if (!this.device?.canProduce?.(track?.kind || "video"))
			throw new Error("Unsupported");

		const safeAppData = { type: "camera", ...(appData || {}) };
		console.log("createProducer called", {
			trackId: track?.id,
			trackKind: track?.kind,
			trackReadyState: track?.readyState,
			appData: safeAppData,
		});

		const produceOptions = {
			track,
			appData: safeAppData,
		};

		if (track?.kind === "video") {
			const decision = this.getVideoEncodingDecision();
			this.activeVideoStrategy = decision.strategy;

			console.info("Video encoding decision", {
				strategy: decision.strategy,
				scalabilityMode: decision.scalabilityMode,
			});

			produceOptions.encodings =
				decision.strategy === "svc"
					? svcEncodingTemplate(decision.scalabilityMode)
					: videoEncodings;
			if (decision.strategy === "svc") {
				const vp9Codec = this.device?.rtpCapabilities?.codecs?.find((codec) =>
					codec.mimeType.toLowerCase().includes("vp9"),
				);
				if (vp9Codec) {
					produceOptions.codec = vp9Codec;
				}
			}
			produceOptions.codecOptions = videoCodecOptions;
			produceOptions.appData = {
				...safeAppData,
				codecStrategy: decision.strategy,
				scalabilityMode: decision.scalabilityMode,
			};
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
