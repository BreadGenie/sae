import { io, type Socket } from "socket.io-client";
import { socketio_port } from "../../../../sites/common_site_config.json";

declare global {
	interface Window {
		site_name?: string;
	}
}

let socket: Socket | null = null;

export function initSocket(): Socket {
	const host = window.location.hostname;
	const siteName = window.site_name || "sae.local";
	const port = window.location.port ? `:${socketio_port}` : "";
	const protocol = port ? "http" : "https";
	const url = `${protocol}://${host}${port}/${siteName}`;

	socket = io(url, {
		withCredentials: true,
		transports: ["websocket", "polling"],
		reconnectionAttempts: 5,
	});

	return socket;
}

export function useSocket(): Socket | null {
	return socket;
}
