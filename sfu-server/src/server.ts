import 'dotenv/config';
import http from 'node:http';
import cors from 'cors';
import express, { type Application } from 'express';
import { Server } from 'socket.io';
import { MediasoupManager } from './mediasoup/MediasoupManager';
import { AuthManager } from './server/AuthManager';
import { RouteManager } from './server/RouteManager';
import { SocketHandlerManager } from './server/SocketHandlerManager';
import { SttManager } from './stt/SttManager';
import type { ServerConfig } from './types';
import { loggers } from './utils/logger';

export class SFUServer {
	private app: Application;
	private server: http.Server;
	private io: Server;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private routeManager: RouteManager;
	private socketHandlerManager: SocketHandlerManager;
	private sttManager: SttManager;
	private config: ServerConfig;

	constructor() {
		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			throw new Error('JWT_SECRET environment variable is required');
		}
		this.config = {
			port: Number.parseInt(process.env.PORT || '3000', 10),
			host: process.env.HOST || '0.0.0.0',
			jwtSecret,
		};

		loggers.server.info(
			'SFU Server will run on http://%s:%d',
			this.config.host,
			this.config.port,
		);

		this.app = express();
		this.server = http.createServer(this.app);
		this.io = new Server(this.server, {
			cors: {
				origin: '*',
				methods: ['GET', 'POST'],
				allowedHeaders: ['*'],
				credentials: false,
			},
			transports: ['websocket', 'polling'],
			pingTimeout: 60000,
			pingInterval: 25000,
			allowEIO3: true,
		});

		this.mediasoup = new MediasoupManager();
		this.authManager = new AuthManager(this.config.jwtSecret);
		this.routeManager = new RouteManager(this.app, this.mediasoup);

		// Initialize STT manager
		const sttUrl = process.env.WHISPER_SERVER_URL;
		this.sttManager = new SttManager({
			whisperServerUrl: sttUrl,
			allowMockFallback: process.env.NODE_ENV === 'development',
		});
		this.sttManager.setEmitToRoom((roomId, event, data) => {
			// Emit only to STT subscribers in the room
			const socketIds = this.sttManager.getSubscribers(roomId);
			if (!socketIds) return;
			for (const socketId of socketIds) {
				const socket = this.io.sockets.sockets.get(socketId);
				if (socket) {
					// biome-ignore lint/suspicious/noExplicitAny: Internal event emission
					(socket as any).emit(event, data);
				}
			}
		});
		this.mediasoup.setSttManager(this.sttManager);

		this.socketHandlerManager = new SocketHandlerManager(
			this.io,
			this.mediasoup,
			this.authManager,
			this.sttManager,
		);

		this.setupMiddleware();
		this.routeManager.setupRoutes();
		this.socketHandlerManager.setupSocketHandlers();
	}

	private setupMiddleware(): void {
		this.app.use(cors());
		this.app.use(express.json());
	}

	async start(): Promise<void> {
		try {
			loggers.server.info('Starting SFU Server');

			await this.mediasoup.init();

			this.server.listen(this.config.port, this.config.host, () => {
				loggers.server.info(
					'SFU Server running on http://%s:%d',
					this.config.host,
					this.config.port,
				);
			});
		} catch (error) {
			loggers.server.error(
				'Failed to start SFU server: %s',
				(error as Error).message,
			);
			process.exit(1);
		}
	}

	async stop(): Promise<void> {
		loggers.server.info('Stopping SFU Server');

		try {
			await this.mediasoup.cleanup();
			this.sttManager.destroy();

			this.server.close(() => {
				loggers.server.info('SFU Server stopped');
			});
		} catch (error) {
			loggers.server.error(
				'Error during server shutdown: %s',
				(error as Error).message,
			);
			this.server.close(() => {
				loggers.server.info('SFU Server force stopped');
			});
		}
	}
}

const sfuServer = new SFUServer();

process.on('SIGINT', async () => {
	loggers.server.info('Received SIGINT, shutting down gracefully');
	await sfuServer.stop();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	loggers.server.info('Received SIGTERM, shutting down gracefully');
	await sfuServer.stop();
	process.exit(0);
});

process.on('uncaughtException', (error) => {
	loggers.server.error(
		'Uncaught exception (server kept alive): %s\n%s',
		error.message,
		error.stack,
	);
});

process.on('unhandledRejection', (reason) => {
	loggers.server.error(
		'Unhandled rejection (server kept alive): %s',
		reason instanceof Error ? reason.message : String(reason),
	);
});

sfuServer.start().catch((error) => {
	loggers.server.error(
		'Failed to start SFU server: %s',
		(error as Error).message,
	);
	process.exit(1);
});
