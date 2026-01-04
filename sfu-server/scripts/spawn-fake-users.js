#!/usr/bin/env node
/**
 * Spawn fake users that connect to the SFU to test layout & participant handling.
 *
 * These fake users:
 *  - Connect via socket.io using JWTs we generate locally (must share secret with SFU)
 *  - Join the target meeting automatically (server auto-joins based on token)
 *  - Optionally create dummy audio/video producers using synthetic MediaStreamTracks (Node doesn't have getUserMedia)
 *    -> For layout testing, we really only need participant_joined events, so media is optional
 *  - Can periodically toggle media_control actions (mute/unmute, video_on/video_off) to test state changes
 *
 * Usage:
 *  node scripts/spawn-fake-users.js \
 *    --meeting MEETING_ID \
 *    --count 8 \
 *    --sfu-url http://localhost \
 *    --sfu-port 3000 \
 *    --secret your_sfu_secret \
 *    [--with-producers] [--auto-toggle]
 *
 * Notes:
 *  - The SFU validates JWT with secret (JWT_SECRET env or fallback-secret). Provide the same value here with --secret.
 *  - If you pass --with-producers the script will attempt to simulate producers using simple RTP capabilities request
 *    and then emit create_producer with mock RTP parameters (sufficient for triggering producer_created events).
 */

const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
	.option("meeting", {
		type: "string",
		demandOption: true,
		describe: "Meeting ID / room ID to join",
	})
	.option("count", {
		type: "number",
		default: 5,
		describe: "Number of fake users to spawn",
	})
	.option("sfu-url", {
		type: "string",
		default: "http://localhost",
		describe: "Base SFU URL (protocol+host)",
	})
	.option("sfu-port", {
		type: "number",
		default: 3000,
		describe: "SFU port if not implicit in URL",
	})
	.option("secret", {
		type: "string",
		default: process.env.JWT_SECRET,
		describe: "JWT signing secret used by SFU (required)",
	})
	.option("with-producers", {
		type: "boolean",
		default: false,
		describe: "Create mock audio/video producers",
	})
	.option("auto-toggle", {
		type: "boolean",
		default: false,
		describe: "Periodically send media_control events",
	})
	.option("lifetime", {
		type: "number",
		default: 0,
		describe: "Milliseconds before disconnecting (0 = keep alive)",
	})
	.help().argv;

const {
	meeting: meetingId,
	count,
	sfuUrl,
	sfuPort,
	secret,
	withProducers,
	autoToggle,
	lifetime,
} = argv;

if (!secret) {
	console.error("Error: JWT secret is required. Provide --secret or set JWT_SECRET environment variable.");
	process.exit(1);
}

const endpoint = (() => {
	try {
		const u = new URL(sfuUrl);
		if (u.port) return u.origin; // full specified
		return `${u.protocol}//${u.hostname}:${sfuPort}`;
	} catch (_) {
		return `${sfuUrl.replace(/\/$/, "")}:${sfuPort}`;
	}
})();

console.log("Spawning fake users with config:", {
	meetingId,
	count,
	endpoint,
	withProducers,
	autoToggle,
	lifetime,
});

function makeToken(userId, index) {
	const now = Math.floor(Date.now() / 1000);
	return jwt.sign(
		{
			user_id: userId,
			meeting_id: meetingId,
			user_name: `Fake User ${index}`,
			iat: now,
			exp: now + 3600,
		},
		secret,
		{ algorithm: "HS256" },
	);
}

function randomDelay(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function spawnUser(index) {
	const userId = `fake.user${index}@example.com`;
	const token = makeToken(userId, index);

	const socket = io(endpoint, {
		auth: { token },
		transports: ["websocket", "polling"],
		reconnection: true,
		reconnectionAttempts: 3,
		reconnectionDelay: 1000,
	});

	socket.on("connect", () => {
		console.log(`[#${index}] ✅ Connected as ${userId}`);

		// Join the meeting room
		socket.emit(
			"join_room",
			{
				roomId: meetingId,
				userData: {
					name: `Fake User ${index}`,
					userId: userId,
					avatar: undefined,
				},
				mediaState: {
					audio_enabled: false,
					video_enabled: false,
				},
			},
			(response) => {
				if (response.success) {
					console.log(`[#${index}] ✅ Joined room ${meetingId}`);
				} else {
					console.error(
						`[#${index}] ❌ Failed to join room: ${response.error}`,
					);
				}
			},
		);
	});
	socket.on("disconnect", (reason) =>
		console.log(`[#${index}] 🔌 Disconnected: ${reason}`),
	);
	socket.on("connect_error", (err) =>
		console.error(`[#${index}] ❌ Connect error:`, err.message),
	);

	socket.on("participant_joined", (d) =>
		console.log(`[#${index}] 👥 participant_joined`, d.participantId),
	);
	socket.on("participant_left", (d) =>
		console.log(`[#${index}] 👋 participant_left`, d.participantId),
	);
	socket.on("producer_created", (d) =>
		console.log(`[#${index}] 🎥 producer_created`, d.producerId, d.kind),
	);
	socket.on("media_control_update", (d) =>
		console.log(
			`[#${index}] 🎛️ media_control_update`,
			d.action,
			"from",
			d.participantId,
		),
	);

	if (withProducers) {
		// After join, ask for router capabilities and create dummy transports & producers.
		socket.on("connect", () => {
			setTimeout(
				() => {
					socket.emit("get_router_rtp_capabilities", {}, (resp) => {
						if (!resp?.success)
							return console.warn(`[#${index}] Failed to get RTP caps`);
						// Create send transport
						socket.emit(
							"create_webrtc_transport",
							{ direction: "send" },
							(tResp) => {
								if (!tResp?.success)
									return console.warn(`[#${index}] Failed to create transport`);
								const transportId = tResp.id;
								// We cannot do real DTLS in Node easily without wrangling libs; skip connect_webrtc_transport.
								// Instead directly emit create_producer expecting the server NOT to validate DTLS state strictly.
								// Provide minimal rtpParameters shape mediasoup expects (may need adjustment if server enforces checks).
								const mockRtpParameters = {
									codecs: [
										{
											mimeType: "audio/opus",
											clockRate: 48000,
											channels: 2,
											payloadType: 111,
											parameters: { minptime: 10, useinbandfec: 1 },
											rtcpFeedback: [],
										},
									],
									encodings: [{ ssrc: Math.floor(Math.random() * 1e9) }],
									rtcp: { cname: "fake", reducedSize: true },
								};

								// Try audio producer
								socket.emit(
									"create_producer",
									{
										transportId,
										rtpParameters: mockRtpParameters,
										kind: "audio",
										appData: { type: "mock" },
									},
									(pResp) => {
										if (!pResp?.success)
											return console.warn(
												`[#${index}] Could not create audio producer (expected if server validates DTLS)`,
											);
										console.log(
											`[#${index}] ✅ Mock audio producer created`,
											pResp.id,
										);
									},
								);

								// Try video producer with simpler params
								const videoRtpParameters = {
									codecs: [
										{
											mimeType: "video/VP8",
											clockRate: 90000,
											payloadType: 96,
											parameters: {},
											rtcpFeedback: [
												{ type: "nack" },
												{ type: "nack", parameter: "pli" },
												{ type: "ccm", parameter: "fir" },
											],
										},
									],
									encodings: [
										{ ssrc: Math.floor(Math.random() * 1e9), active: true },
									],
									rtcp: { cname: "fake", reducedSize: true },
								};

								socket.emit(
									"create_producer",
									{
										transportId,
										rtpParameters: videoRtpParameters,
										kind: "video",
										appData: { type: "camera" },
									},
									(vResp) => {
										if (!vResp?.success)
											return console.warn(
												`[#${index}] Could not create video producer (expected if DTLS enforcement)`,
											);
										console.log(
											`[#${index}] ✅ Mock video producer created`,
											vResp.id,
										);
									},
								);
							},
						);
					});
				},
				randomDelay(500, 1500),
			);
		});
	}

	if (autoToggle) {
		const actions = ["mute", "unmute", "video_off", "video_on"];
		const interval = setInterval(
			() => {
				if (socket.connected) {
					const action = actions[Math.floor(Math.random() * actions.length)];
					socket.emit("media_control", { action });
					console.log(`[#${index}] 🔄 Sent media_control ${action}`);
				}
			},
			randomDelay(4000, 7000),
		);
		socket.on("disconnect", () => clearInterval(interval));
	}

	if (lifetime > 0) {
		setTimeout(() => {
			console.log(`[#${index}] ⏱️ Lifetime reached, disconnecting`);
			socket.disconnect();
		}, lifetime + randomDelay(0, 3000));
	}

	return socket;
}

(async () => {
	const sockets = [];
	for (let i = 0; i < count; i++) {
		await new Promise((r) => setTimeout(r, randomDelay(150, 600))); // stagger
		sockets.push(await spawnUser(i + 1));
	}
	console.log(`🚀 Spawned ${sockets.length} fake users.`);

	process.on("SIGINT", () => {
		console.log("\n🛑 Caught SIGINT, disconnecting fake users...");
		for (const s of sockets) {
			s.disconnect();
		}
		process.exit(0);
	});
})();
