// Copyright (c) 2025, Frappe and contributors
// For license information, please see license.txt

import { frappeRequest } from "frappe-ui";
import { io } from "socket.io-client";

class SFUClient {
	constructor() {
		this.socket = null;
		this.connected = false;
		this.connectionDetails = {
			authToken: null,
			meetingId: null,
			userId: null,
			sfuUrl: null,
			sfuPort: null,
		};
		this.eventHandlers = new Map();
		this.setupDefaultHandlers();
	}

	// ==================== CONNECTION MANAGEMENT ====================

	async connect(meetingId) {
		try {
			const connectionDetails = await this.getConnectionDetails(meetingId);
			this.connectionDetails = connectionDetails;

			await this.validateSFUHealth();

			await this.establishSocketConnection();

			return true;
		} catch (error) {
			console.error("❌ SFU connection failed:", error);
			throw error;
		}
	}

	async getConnectionDetails(meetingId) {
		const response = await frappeRequest({
			url: "sae.api.meeting.get_sfu_connection_details",
			params: { meeting_id: meetingId },
		});

		if (!response.success) {
			throw new Error(response.error || "Failed to get SFU connection details");
		}

		const { sfu_url, sfu_port, auth_token, user_id, meeting_id, user_data } =
			response;

		return {
			authToken: auth_token,
			meetingId: meeting_id,
			userId: user_id,
			sfuUrl: sfu_url,
			sfuPort: sfu_port,
			userData: user_data,
		};
	}

	async validateSFUHealth() {
		const { sfuUrl, sfuPort } = this.connectionDetails;

		let sfuEndpoint;
		const urlObj = new URL(sfuUrl);
		const isSecured = urlObj.protocol === "https:";

		if (isSecured) {
			sfuEndpoint = urlObj.origin;
		} else {
			sfuEndpoint = `${urlObj.protocol}//${urlObj.hostname}:${sfuPort}`;
		}

		try {
			const healthResponse = await fetch(`${sfuEndpoint}/health`);
			if (!healthResponse.ok) {
				console.warn(
					"⚠️ SFU health check failed, but attempting connection anyway",
				);
			}
		} catch (fetchError) {
			console.warn(
				"⚠️ SFU health check failed:",
				fetchError.message,
				"- attempting socket connection anyway",
			);
		}

		return sfuEndpoint;
	}

	async establishSocketConnection() {
		const sfuEndpoint = await this.validateSFUHealth();
		const { authToken } = this.connectionDetails;

		this.socket = io(sfuEndpoint, {
			auth: { token: authToken },
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
			transports: ["websocket", "polling"],
			upgrade: true,
			timeout: 20000,
			forceNew: true,
			withCredentials: false,
		});

		this.registerEventHandlers();

		return new Promise((resolve, reject) => {
			this.socket.on("connect", () => {
				this.connected = true;
				resolve();
			});

			this.socket.on("connect_error", (error) => {
				console.error("❌ Socket connection failed:", {
					message: error.message,
					description: error.description,
					context: error.context,
					type: error.type,
					endpoint: sfuEndpoint,
				});
				this.connected = false;
				reject(new Error(`SFU connection failed: ${error.message || error}`));
			});

			this.socket.on("disconnect", (reason) => {
				this.connected = false;
			});

			setTimeout(() => {
				if (!this.connected) {
					console.error("❌ SFU connection timeout after 10 seconds");
					reject(new Error("SFU connection timeout"));
				}
			}, 10000);
		});
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.connected = false;
		this.connectionDetails = {
			authToken: null,
			meetingId: null,
			userId: null,
			sfuUrl: null,
			sfuPort: null,
		};
	}

	// ==================== EVENT HANDLING ====================

	setupDefaultHandlers() {
		const defaultHandlers = {
			connect: () => {
				this.connected = true;
			},
			disconnect: () => {
				this.connected = false;
			},
			connect_error: (error) => {
				console.error("❌ SFU connection error:", error);
				this.connected = false;
			},
			participant_joined: () => {},
			participant_left: () => {},
			producer_created: () => {},
			producer_closed: () => {},
			consumer_created: () => {},
			consumer_closed: () => {},
			media_control_update: () => {},
			screen_share_started: () => {},
			screen_share_stopped: () => {},
			webrtc_offer: () => {},
			webrtc_answer: () => {},
			ice_candidate: () => {},
			"chat:message": () => {},
		};

		for (const [event, handler] of Object.entries(defaultHandlers)) {
			this.eventHandlers.set(event, handler);
		}
	}

	registerEventHandlers() {
		if (!this.socket) return;

		for (const [event, handler] of this.eventHandlers.entries()) {
			this.socket.on(event, handler);
		}
	}

	on(event, handler) {
		this.eventHandlers.set(event, handler);
		if (this.socket) {
			this.socket.on(event, handler);
		}
	}

	off(event) {
		const handler = this.eventHandlers.get(event);
		if (handler && this.socket) {
			this.socket.off(event, handler);
		}
		this.eventHandlers.delete(event);
	}

	// ==================== WEBRTC OPERATIONS ====================

	async getRouterRtpCapabilities() {
		const resp = await this.sendRequest("get_router_rtp_capabilities", {});
		try {
			const payload = resp?.rtpCapabilities || resp;
			return JSON.parse(JSON.stringify(payload));
		} catch (err) {
			console.warn("Failed to deep-clone router RTP capabilities:", err);
			return resp?.rtpCapabilities || resp;
		}
	}

	async createWebRtcTransport(direction) {
		const response = await this.sendRequest("create_webrtc_transport", {
			direction,
		});
		try {
			const clean = JSON.parse(JSON.stringify(response));
			const { id, iceParameters, iceCandidates, dtlsParameters } = clean;
			return { id, iceParameters, iceCandidates, dtlsParameters };
		} catch (err) {
			console.warn(
				"Failed to deep-clone transport response, returning raw response",
				err,
			);
			const { id, iceParameters, iceCandidates, dtlsParameters } = response;
			return { id, iceParameters, iceCandidates, dtlsParameters };
		}
	}

	async connectWebRtcTransport(transportId, dtlsParameters) {
		console.log(`🔗 Connecting transport ${transportId} to SFU...`);
		console.log("📋 DTLS Parameters:", dtlsParameters);

		await this.sendRequest("connect_webrtc_transport", {
			transportId,
			dtlsParameters,
		});

		console.log(`✅ Transport ${transportId} connected successfully`);
	}

	async createProducer(transportId, rtpParameters, kind, appData = {}) {
		return this.sendRequest("create_producer", {
			transportId,
			rtpParameters,
			kind,
			appData,
		});
	}

	async createConsumer(transportId, producerId, rtpCapabilities) {
		console.log(
			`📡 Creating consumer for producer ${producerId} @ ${Date.now()}`,
		);
		return this.sendRequest("create_consumer", {
			transportId,
			producerId,
			rtpCapabilities,
		});
	}

	async closeProducer(producerId) {
		return this.sendRequest("close_producer", { producerId });
	}

	async closeConsumer(consumerId) {
		return this.sendRequest("close_consumer", { consumerId });
	}

	// ==================== ROOM OPERATIONS ====================

	async getExistingProducers(roomId = null) {
		const requestData = roomId ? { roomId } : {};
		const response = await this.sendRequest(
			"get_existing_producers",
			requestData,
		);
		return response.producers;
	}

	async getRoomParticipants() {
		const response = await this.sendRequest("get_room_participants", {});
		return response.participants;
	}

	// ==================== SIGNALING OPERATIONS ====================

	sendWebRtcOffer(targetUser, signalData) {
		this.sendEvent("webrtc_offer", { targetUser, signalData });
	}

	sendWebRtcAnswer(targetUser, signalData) {
		this.sendEvent("webrtc_answer", { targetUser, signalData });
	}

	sendIceCandidate(targetUser, signalData) {
		this.sendEvent("ice_candidate", { targetUser, signalData });
	}

	// ==================== MEDIA CONTROL ====================

	sendMediaControl(action) {
		this.sendEvent("media_control", { action });
	}

	sendScreenShare(action, shareData = {}) {
		this.sendEvent("screen_share", { action, shareData });
	}

	// ==================== CHAT OPERATIONS ====================

	sendChatMessage(message, options = {}) {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}

		const payload = { message: String(message || "") };
		if (options.clientId) {
			payload.clientId = String(options.clientId);
		}

		this.sendEvent("chat:send", payload);
	}

	async sendRequest(event, data) {
		return new Promise((resolve, reject) => {
			if (!this.connected) {
				reject(new Error("Not connected to SFU"));
				return;
			}

			this.socket.emit(event, data, (response) => {
				if (response.success) {
					resolve(response);
				} else {
					const error = new Error(response.error || `Request failed: ${event}`);
					console.error(`❌ SFU request failed (${event}):`, response.error);
					reject(error);
				}
			});
		});
	}

	sendEvent(event, data) {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}
		this.socket.emit(event, data);
	}

	isConnected() {
		return this.connected;
	}

	getMeetingId() {
		return this.connectionDetails.meetingId;
	}

	getUserId() {
		return this.connectionDetails.userId;
	}

	getConnectionStatus() {
		return {
			connected: this.connected,
			meetingId: this.connectionDetails.meetingId,
			userId: this.connectionDetails.userId,
			socketId: this.socket?.id || null,
		};
	}
}

let sfuClient = null;

export function getSFUClient() {
	if (!sfuClient) {
		sfuClient = new SFUClient();
	}
	return sfuClient;
}

export function createSFUClient() {
	return new SFUClient();
}

export default getSFUClient;
