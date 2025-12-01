import { Device } from "mediasoup-client";
import { resolveCodecStrategy } from "./utils/media/codecStrategy.ts";
import {
	screenEncodings,
	svcEncodingTemplate,
	videoCodecOptions,
	videoEncodings,
} from "./utils/media/encodings.js";
import { getSFUClient } from "./utils/sfu-client.js";

// MediaSoup state management
let mediasoupDevice = null;
let sendTransport = null;
let recvTransport = null;
const producers = new Map();
const consumers = new Map();

// Event handlers for mediasoup events
let mediasoupEventHandlers = {};

function buildVideoEncodingConfig(source = "camera") {
	const sfuClient = getSFUClient();
	const preference = sfuClient?.getCodecStrategy?.() || "auto";
	const decision = resolveCodecStrategy({
		preference,
		deviceCapabilities: mediasoupDevice?.rtpCapabilities,
	});

	const fallbackEncodings =
		source === "screen" ? screenEncodings : videoEncodings;

	return {
		decision,
		encodings:
			decision.strategy === "svc"
				? svcEncodingTemplate(decision.scalabilityMode)
				: fallbackEncodings,
	};
}

/**
 * Initialize the mediasoup device with router capabilities
 */
export async function initializeMediasoupDevice(routerRtpCapabilities) {
	try {
		if (!mediasoupDevice) {
			mediasoupDevice = new Device();
		}

		if (!mediasoupDevice.loaded) {
			await mediasoupDevice.load({ routerRtpCapabilities });
		}

		return mediasoupDevice;
	} catch (error) {
		console.error("❌ Failed to load mediasoup device:", error);
		throw error;
	}
}

/**
 * Get router capabilities from the SFU (direct connection)
 */
export async function getRouterCapabilities(meetingId) {
	try {
		const sfuClient = getSFUClient();

		// Ensure SFU client is connected
		if (!sfuClient.isConnected()) {
			await sfuClient.connect(meetingId);
		}

		const capabilities = await sfuClient.getRouterRtpCapabilities();
		await initializeMediasoupDevice(capabilities);

		return {
			rtpCapabilities: capabilities,
			status: "success",
		};
	} catch (error) {
		console.error("❌ Error getting router capabilities:", error);
		throw error;
	}
}

/**
 * Create a WebRTC transport (send or receive)
 */
export async function createTransport(
	meetingId,
	transportType = "send",
	options = {},
) {
	// Wait for device to be loaded if it's not ready yet
	if (!mediasoupDevice || !mediasoupDevice.loaded) {
		await getRouterCapabilities(meetingId);
	}

	if (!mediasoupDevice || !mediasoupDevice.loaded) {
		throw new Error(
			"Mediasoup device not loaded. Call getRouterCapabilities first.",
		);
	}

	try {
		const sfuClient = getSFUClient();

		if (!sfuClient.isConnected()) {
			await sfuClient.connect(meetingId);
		}

		await new Promise((resolve) => setTimeout(resolve, 100));

		const direction = transportType === "recv" ? "receive" : transportType;

		const transportOptions = await sfuClient.createWebRtcTransport(direction);

		// Validate transport options
		if (!transportOptions || !transportOptions.id) {
			throw new Error(
				`Invalid transport options received: ${JSON.stringify(transportOptions)}`,
			);
		}

		// Validate critical transport properties
		const validation = validateTransportOptions(transportOptions);
		if (!validation.valid) {
			// Check if this is the critical localhost issue
			if (
				validation.warnings.some(
					(w) => w.includes("localhost") || w.includes("127.0.0.1"),
				)
			) {
				console.error(
					"🚨 CRITICAL SERVER CONFIGURATION ERROR: MediaSoup server advertising localhost ICE candidates",
				);
				console.error(
					"Clients cannot connect from outside the server machine. Check WEBRTC_ANNOUNCED_IP configuration.",
				);
			}
		}

		// Create the transport based on type
		if (transportType === "send") {
			if (!sendTransport) {
				sendTransport = mediasoupDevice.createSendTransport(transportOptions);
				setupSendTransportEvents(sendTransport, meetingId);
				monitorTransportHealth(sendTransport, "send", meetingId);
			}
			return { transport: sendTransport, transportOptions };
		}
		if (transportType === "recv") {
			if (!recvTransport) {
				recvTransport = mediasoupDevice.createRecvTransport(transportOptions);
				recvTransport._createdAt = Date.now();
				setupRecvTransportEvents(recvTransport, meetingId);
				monitorTransportHealth(recvTransport, "recv", meetingId);
			}
			return { transport: recvTransport, transportOptions };
		}

		throw new Error(`Unknown transport type: ${transportType}`);
	} catch (error) {
		console.error(`❌ Error creating ${transportType} transport:`, error);
		throw error;
	}
}

/**
 * Connect a transport with DTLS parameters - Direct SFU connection
 */
export async function connectTransport(meetingId, transportId, dtlsParameters) {
	try {
		const sfuClient = getSFUClient();

		if (!sfuClient.isConnected()) {
			throw new Error("SFU client not connected");
		}
		// Connect transport directly with SFU
		await sfuClient.connectWebRtcTransport(transportId, dtlsParameters);

		return { success: true };
	} catch (error) {
		console.error(`❌ Error connecting transport ${transportId}:`, error);
		throw error;
	}
}

/**
 * Produce media (audio or video) - Direct SFU connection
 */
export async function produceMedia(
	meetingId,
	transportId,
	kind,
	rtpParameters,
	paused = false,
	appData = {},
) {
	try {
		const sfuClient = getSFUClient();

		if (!sfuClient.isConnected()) {
			throw new Error("SFU client not connected");
		}

		// Create producer directly with SFU
		const response = await sfuClient.createProducer(
			transportId,
			rtpParameters,
			kind,
			appData,
		);

		// Store producer reference
		if (response.id) {
			producers.set(response.id, {
				id: response.id,
				kind,
				paused,
				appData,
			});
		}

		return response;
	} catch (error) {
		console.error(`❌ Error producing ${kind} media:`, error);
		throw error;
	}
}

/**
 * Consume media from a producer - Direct SFU connection
 */
export async function consumeMedia(
	meetingId,
	producerId,
	rtpCapabilities,
	paused = false,
) {
	try {
		const sfuClient = getSFUClient();

		if (!sfuClient.isConnected()) {
			throw new Error("SFU client not connected");
		}

		// Get receive transport
		if (!recvTransport) {
			throw new Error("Receive transport not created");
		}

		// Create consumer directly with SFU
		const response = await sfuClient.createConsumer(
			recvTransport.id,
			producerId,
			rtpCapabilities,
		);

		// Store consumer reference
		if (response.id) {
			consumers.set(response.id, {
				id: response.id,
				producerId,
				paused,
			});
		}

		return response;
	} catch (error) {
		console.error(
			`❌ Error consuming media from producer ${producerId}:`,
			error,
		);
		throw error;
	}
}

/**
 * Pause or resume a producer
 */
export async function pauseResumeProducer(meetingId, producerId, action) {
	try {
		const sfuClient = getSFUClient();
		if (!sfuClient.isConnected()) await sfuClient.connect(meetingId);
		if (action === "pause") {
			await sfuClient.pauseProducer(producerId);
		} else if (action === "resume") {
			await sfuClient.resumeProducer(producerId);
		} else {
			throw new Error(`Unknown action ${action}`);
		}
		return { success: true };
	} catch (error) {
		console.error("Error controlling producer:", error);
		throw error;
	}
}

/**
 * Pause or resume a consumer
 */
export async function pauseResumeConsumer(meetingId, consumerId, action) {
	try {
		const sfuClient = getSFUClient();
		if (!sfuClient.isConnected()) await sfuClient.connect(meetingId);
		if (action === "pause") {
			await sfuClient.pauseConsumer(consumerId);
		} else if (action === "resume") {
			await sfuClient.resumeConsumer(consumerId);
		} else {
			throw new Error(`Unknown action ${action}`);
		}
		return { success: true };
	} catch (error) {
		console.error("Error controlling consumer:", error);
		throw error;
	}
}

/**
 * Set up event handlers for send transport
 */
function setupSendTransportEvents(transport, meetingId) {
	transport.on("icestatechange", (iceState) => {
		if (iceState === "failed") {
			console.error(`❌ Send transport ICE failed: ${transport.id}`);
		}
	});

	transport.on("dtlsstatechange", (dtlsState) => {
		if (dtlsState === "failed") {
			console.error(`❌ Send transport DTLS failed: ${transport.id}`);
		}
	});

	transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
		try {
			await connectTransport(meetingId, transport.id, dtlsParameters);
			callback();
		} catch (error) {
			console.error(
				`❌ Send transport connect failed for ${transport.id}:`,
				error,
			);
			errback(error);
		}
	});

	transport.on(
		"produce",
		async ({ kind, rtpParameters, appData }, callback, errback) => {
			try {
				const response = await produceMedia(
					meetingId,
					transport.id,
					kind,
					rtpParameters,
					false,
					appData,
				);
				const producerId = response?.producerId || response?.id;
				callback({ id: producerId });
			} catch (error) {
				console.error(`❌ Send transport produce failed for ${kind}:`, error);
				errback(error);
			}
		},
	);

	transport.on("connectionstatechange", (state) => {
		if (state === "failed" || state === "closed") {
			console.error(`❌ Send transport connection ${state}: ${transport.id}`);
		}

		if (mediasoupEventHandlers.onTransportConnectionStateChange) {
			mediasoupEventHandlers.onTransportConnectionStateChange({
				transportType: "send",
				state,
				transport,
			});
		}
	});
}

/**
 * Set up event handlers for receive transport
 */
function setupRecvTransportEvents(transport, meetingId) {
	transport.on("icestatechange", (iceState) => {
		if (iceState === "failed") {
			console.error(
				`❌ ICE connection failed for recv transport ${transport.id}`,
			);
		}
	});

	transport.on("dtlsstatechange", (dtlsState) => {
		if (dtlsState === "failed") {
			console.error(
				`❌ DTLS handshake failed for recv transport ${transport.id}`,
			);
		}
	});

	transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
		try {
			await connectTransport(meetingId, transport.id, dtlsParameters);
			callback();
		} catch (error) {
			console.error(
				`❌ Recv transport connect failed for ${transport.id}:`,
				error,
			);
			errback(error);
		}
	});

	transport.on("connectionstatechange", (state) => {
		if (state === "failed") {
			console.error(`❌ Recv transport failed for ${transport.id}`);

			// Clean up the failed transport
			if (recvTransport && recvTransport.id === transport.id) {
				try {
					recvTransport.close();
				} catch (e) {
					console.warn("Error closing failed transport:", e);
				}
				recvTransport = null;
			}
		}

		if (mediasoupEventHandlers.onTransportConnectionStateChange) {
			mediasoupEventHandlers.onTransportConnectionStateChange({
				transportType: "recv",
				state,
				transport,
			});
		}
	});
}

/**
 * Publish video stream
 */
export async function publishVideo(meetingId, stream) {
	await ensureDeviceReady(meetingId);

	if (!sendTransport) {
		await createTransport(meetingId, "send");
	}

	try {
		const videoTrack = stream.getVideoTracks()[0];
		if (!videoTrack) {
			throw new Error("No video track found in stream");
		}

		const encodingConfig = buildVideoEncodingConfig("camera");

		const producer = await sendTransport.produce({
			track: videoTrack,
			encodings: encodingConfig.encodings,
			codecOptions: videoCodecOptions,
			appData: {
				codecStrategy: encodingConfig.decision.strategy,
				scalabilityMode: encodingConfig.decision.scalabilityMode,
			},
		});

		producers.set(producer.id, producer);

		producer.on("trackended", () => {
			console.log("Video track ended");
		});

		producer.on("transportclose", () => {
			console.log("Video producer transport closed");
		});

		return producer;
	} catch (error) {
		console.error("Error publishing video:", error);
		throw error;
	}
}

/**
 * Publish screen share stream (separate producer)
 */
export async function publishScreenShare(meetingId, stream) {
	await ensureDeviceReady(meetingId);

	if (!sendTransport) {
		await createTransport(meetingId, "send");
	}

	try {
		const videoTrack = stream.getVideoTracks()[0];
		if (!videoTrack) throw new Error("No video track in screen share stream");

		const encodingConfig = buildVideoEncodingConfig("screen");

		const producer = await sendTransport.produce({
			track: videoTrack,
			appData: {
				type: "screen",
				codecStrategy: encodingConfig.decision.strategy,
				scalabilityMode: encodingConfig.decision.scalabilityMode,
			},
			encodings: encodingConfig.encodings,
			codecOptions: videoCodecOptions,
		});

		producers.set(producer.id, producer);

		producer.on("trackended", () => {
			console.log("Screen share track ended");
		});
		producer.on("transportclose", () => {
			console.log("Screen share producer transport closed");
		});

		return producer;
	} catch (e) {
		console.error("Error publishing screen share:", e);
		throw e;
	}
}

/**
 * Publish audio stream
 */
export async function publishAudio(meetingId, stream) {
	await ensureDeviceReady(meetingId);

	if (!sendTransport) {
		await createTransport(meetingId, "send");
	}

	try {
		const audioTrack = stream.getAudioTracks()[0];
		if (!audioTrack) {
			throw new Error("No audio track found in stream");
		}

		const producer = await sendTransport.produce({
			track: audioTrack,
			codecOptions: {
				opusStereo: 1,
				opusDtx: 1,
			},
		});

		producers.set(producer.id, producer);

		producer.on("trackended", () => {
			console.log("Audio track ended");
		});

		producer.on("transportclose", () => {
			console.log("Audio producer transport closed");
		});

		return producer;
	} catch (error) {
		console.error("Error publishing audio:", error);
		throw error;
	}
}

/**
 * Subscribe to a producer's media
 */
export async function subscribeToProducer(meetingId, producerId) {
	await ensureDeviceReady(meetingId);

	// Check if recv transport exists and is in good state
	if (
		!recvTransport ||
		recvTransport.connectionState === "failed" ||
		recvTransport.connectionState === "closed"
	) {
		// Close the failed transport if it exists
		if (recvTransport) {
			try {
				recvTransport.close();
			} catch (e) {
				console.warn("Error closing failed transport:", e);
			}
			recvTransport = null;
		}

		// Create a new receive transport
		await createTransport(meetingId, "recv");
	}

	// Double-check the transport is ready
	if (!recvTransport) {
		throw new Error("Failed to create or get receive transport");
	}

	try {
		const response = await consumeMedia(
			meetingId,
			producerId,
			mediasoupDevice.rtpCapabilities,
		);

		// The consume operation will trigger the transport connection automatically
		const consumer = await recvTransport.consume({
			id: response.id,
			producerId: response.producerId,
			kind: response.kind,
			rtpParameters: response.rtpParameters,
		});

		consumers.set(consumer.id, consumer);

		// Ensure consumer is resumed if paused
		if (consumer.paused) {
			try {
				await consumer.resume();
			} catch (resumeError) {
				console.error(
					`❌ Failed to resume consumer ${consumer.id}:`,
					resumeError,
				);
			}
		}

		consumer.on("transportclose", () => {
			console.log("Consumer transport closed");
		});

		// Add consumer error handling
		consumer.on("close", () => {
			consumers.delete(consumer.id);
		});

		return consumer;
	} catch (error) {
		console.error(`❌ Error subscribing to producer ${producerId}:`, error);

		// If transport connection failed during consume, clean it up
		if (
			recvTransport &&
			(recvTransport.connectionState === "failed" ||
				recvTransport.connectionState === "closed")
		) {
			try {
				recvTransport.close();
			} catch (e) {
				console.warn("Error closing failed transport:", e);
			}
			recvTransport = null;
		}

		throw error;
	}
}

/**
 * Request existing producers when joining a meeting
 */
export async function requestExistingProducers(meetingId) {
	try {
		const sfuClient = getSFUClient();

		const existingProducers = await sfuClient.getExistingProducers(meetingId);

		// Create response in expected format
		const response = { producers: existingProducers };

		// Process the existing producers and automatically subscribe to them
		if (response?.producers) {
			const existingProducers = response.producers;

			// Subscribe to each existing producer
			const subscriptionPromises = existingProducers.map(async (producer) => {
				try {
					const consumer = await subscribeToProducer(meetingId, producer.id);
					if (consumer) {
						return { consumer, producer };
					}
				} catch (error) {
					console.error(
						`Failed to subscribe to producer ${producer.id}:`,
						error,
					);
				}
				return null;
			});

			// Wait for all subscriptions to complete
			const results = await Promise.allSettled(subscriptionPromises);
			const successfulSubscriptions = results
				.filter((result) => result.status === "fulfilled" && result.value)
				.map((result) => result.value);

			return {
				total: existingProducers.length,
				subscribed: successfulSubscriptions.length,
				subscriptions: successfulSubscriptions,
			};
		}

		return response;
	} catch (error) {
		console.error("Error requesting existing producers:", error);
		throw error;
	}
}

/**
 * Monitor transport health and attempt recovery
 */
function monitorTransportHealth(transport, transportType, meetingId) {
	// Basic monitoring for critical failures
	transport.on("connectionstatechange", (state) => {
		if (state === "failed" || state === "closed") {
			console.error(`${transportType} transport ${state}: ${transport.id}`);
		}
	});
}

/**
 * Validate transport options for potential issues
 */
function validateTransportOptions(transportOptions) {
	const warnings = [];

	// Check ICE parameters
	if (!transportOptions.iceParameters) {
		warnings.push("Missing ICE parameters");
	}

	// Check ICE candidates for localhost issue
	if (
		!transportOptions.iceCandidates ||
		transportOptions.iceCandidates.length === 0
	) {
		warnings.push("No ICE candidates provided");
	} else {
		const hasLocalhostCandidates = transportOptions.iceCandidates.some(
			(c) => c.address === "127.0.0.1" || c.address === "localhost",
		);

		if (hasLocalhostCandidates) {
			warnings.push(
				"⚠️ CRITICAL: Server advertising localhost (127.0.0.1) - clients cannot connect! Check WEBRTC_ANNOUNCED_IP configuration.",
			);
		}
	}

	// Check DTLS parameters
	if (!transportOptions.dtlsParameters) {
		warnings.push("Missing DTLS parameters");
	}

	return {
		valid: warnings.length === 0,
		warnings,
	};
}

/**
 * Network diagnostics to help identify transport issues
 */
export async function runNetworkDiagnostics() {
	const diagnostics = {
		timestamp: new Date().toISOString(),
		browser: navigator.userAgent,
		webrtcSupport: {
			getUserMedia: !!navigator.mediaDevices?.getUserMedia,
			rtcPeerConnection: !!window.RTCPeerConnection,
			webrtcAdapter: typeof adapter !== "undefined",
		},
		network: {},
	};

	try {
		// Test STUN server connectivity
		const pc = new RTCPeerConnection({
			iceServers: [
				{ urls: "stun:stun.l.google.com:19302" },
				{ urls: "stun:global.stun.twilio.com:3478" },
			],
		});

		const dataChannel = pc.createDataChannel("test");

		const iceGatheringPromise = new Promise((resolve) => {
			const candidates = [];

			pc.onicecandidate = (event) => {
				if (event.candidate) {
					candidates.push(event.candidate);
				} else {
					resolve(candidates);
				}
			};
		});

		await pc.setLocalDescription(await pc.createOffer());

		// Wait up to 5 seconds for ICE gathering
		const iceCandidates = await Promise.race([
			iceGatheringPromise,
			new Promise((resolve) => setTimeout(() => resolve([]), 5000)),
		]);

		diagnostics.network = {
			iceCandidatesFound: iceCandidates.length,
			candidateTypes: [...new Set(iceCandidates.map((c) => c.type))],
			hasHostCandidates: iceCandidates.some((c) => c.type === "host"),
			hasSrflxCandidates: iceCandidates.some((c) => c.type === "srflx"),
			hasRelayCandidates: iceCandidates.some((c) => c.type === "relay"),
		};

		pc.close();

		return diagnostics;
	} catch (error) {
		console.error("❌ Network diagnostics failed:", error);
		diagnostics.error = error.message;
		return diagnostics;
	}
}

async function ensureDeviceReady(meetingId) {
	if (!mediasoupDevice || !mediasoupDevice.loaded) {
		await getRouterCapabilities(meetingId);
	}

	if (!mediasoupDevice || !mediasoupDevice.loaded) {
		throw new Error("Failed to load mediasoup device");
	}
}

export function cleanupMediasoup() {
	// Close all producers
	for (const producer of producers.values()) {
		producer.close();
	}
	producers.clear();

	// Close all consumers
	for (const consumer of consumers.values()) {
		consumer.close();
	}
	consumers.clear();

	// Close transports
	if (sendTransport) {
		sendTransport.close();
		sendTransport = null;
	}
	if (recvTransport) {
		recvTransport.close();
		recvTransport = null;
	}

	// Reset device
	mediasoupDevice = null;
}

/**
 * Register event handlers for mediasoup events
 */
export function registerMediasoupEventHandlers(handlers) {
	mediasoupEventHandlers = { ...mediasoupEventHandlers, ...handlers };
}

/**
 * Remove event handlers
 */
export function unregisterMediasoupEventHandlers() {
	mediasoupEventHandlers = {};
}

// Getters for accessing internal state
export function getProducers() {
	return Array.from(producers.values());
}

export function getConsumers() {
	return Array.from(consumers.values());
}

export function getMediasoupDevice() {
	return mediasoupDevice;
}

export function getSendTransport() {
	return sendTransport;
}

export function getRecvTransport() {
	return recvTransport;
}

/**
 * Enhanced consumer creation with validation
 */
export async function createValidatedConsumer(
	meetingId,
	producerId,
	allowUnconnectedTransport = false,
) {
	try {
		const consumer = await subscribeToProducer(meetingId, producerId);

		return consumer;
	} catch (error) {
		console.error(
			`❌ Failed to create validated consumer for producer ${producerId}:`,
			error,
		);

		throw error;
	}
}

/**
 * Get current transport status for debugging
 * Don't remove
 */
export function getTransportStatus() {
	const status = {
		timestamp: new Date().toISOString(),
		device: {
			loaded: mediasoupDevice?.loaded,
			rtpCapabilities: !!mediasoupDevice?.rtpCapabilities,
		},
		sendTransport: sendTransport
			? {
					id: sendTransport.id,
					connectionState: sendTransport.connectionState,
					iceConnectionState: sendTransport.iceConnectionState,
					iceGatheringState: sendTransport.iceGatheringState,
					dtlsState: sendTransport.dtlsState,
				}
			: null,
		recvTransport: recvTransport
			? {
					id: recvTransport.id,
					connectionState: recvTransport.connectionState,
					iceConnectionState: recvTransport.iceConnectionState,
					iceGatheringState: recvTransport.iceGatheringState,
					dtlsState: recvTransport.dtlsState,
				}
			: null,
		producers: Array.from(producers.values()).map((p) => ({
			id: p.id,
			kind: p.kind,
			paused: p.paused,
		})),
		consumers: Array.from(consumers.values()).map((c) => ({
			id: c.id,
			producerId: c.producerId,
			paused: c.paused,
		})),
	};

	return status;
}
