import type { Application, Request, Response } from 'express';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { HealthStats } from '../types';

import fs from 'node:fs';
import path from 'node:path';

export class RouteManager {
	private app: Application;
	private mediasoup: MediasoupManager;

	private static version: string = RouteManager.readVersion();

	private static readVersion(): string {
		try {
			const pkgPath = path.join(__dirname, '..', '..', 'package.json');
			const raw = fs.readFileSync(pkgPath, 'utf8');
			const json = JSON.parse(raw) as { version?: string };
			return json.version ?? 'unknown';
		} catch (_err) {
			return 'unknown';
		}
	}

	constructor(app: Application, mediasoup: MediasoupManager) {
		this.app = app;
		this.mediasoup = mediasoup;
	}

	setupRoutes(): void {
		this.app.get('/', (_req: Request, res: Response) => {
			res.json({
				message: 'Frappe Meet SFU Server is running',
				version: RouteManager.version,
				timestamp: new Date().toISOString(),
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
	}
}
