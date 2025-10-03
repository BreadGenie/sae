import express, {
	type Application,
	type Request,
	type Response,
} from 'express';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { HealthStats } from '../types';

export class RouteManager {
	private app: Application;
	private mediasoup: MediasoupManager;

	constructor(app: Application, mediasoup: MediasoupManager) {
		this.app = app;
		this.mediasoup = mediasoup;
	}

	setupRoutes(): void {
		this.app.get('/', (_req: Request, res: Response) => {
			res.json({
				message: 'Frappe Meet SFU Server is running',
				version: '1.0.0',
				timestamp: new Date().toISOString(),
				rooms: this.mediasoup.rooms.getAllRoomsStats(),
			});
		});

		this.app.get('/health', (_req: Request, res: Response) => {
			const stats: HealthStats = {
				status: 'healthy',
				uptime: process.uptime(),
				memory: process.memoryUsage(),
				rooms: this.mediasoup.rooms.getRoomCount(),
				peers: this.mediasoup.peers.getPeerCount(),
			};
			res.json(stats);
		});

		this.app.get('/rooms', (_req: Request, res: Response) => {
			res.json({
				rooms: this.mediasoup.rooms.getAllRoomsStats(),
			});
		});
	}
}
