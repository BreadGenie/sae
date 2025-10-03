import * as mediasoup from 'mediasoup';
import type { WorkerSettings } from '../types';
import { loggers } from '../utils/logger';

export class WorkerManager {
	private workers: mediasoup.types.Worker[] = [];
	private nextWorkerIndex = 0;

	async initialize(
		numWorkers: number,
		workerSettings: WorkerSettings,
	): Promise<void> {
		loggers.workerManager.info('Initializing Mediasoup workers');

		for (let i = 0; i < numWorkers; i++) {
			const worker = await mediasoup.createWorker(workerSettings);

			worker.on('died', () => {
				loggers.workerManager.error(
					'Mediasoup worker %d died, initiating cleanup and restart',
					i + 1,
				);

				this.cleanup()
					.then(() => {
						loggers.workerManager.info('Cleanup completed, restarting process');
						setTimeout(() => process.exit(1), 2000);
					})
					.catch((error) => {
						loggers.workerManager.error(
							'Error during cleanup after worker death: %s',
							(error as Error).message,
						);
						setTimeout(() => process.exit(1), 1000);
					});
			});

			this.workers.push(worker);
			loggers.workerManager.info('Created worker %d/%d', i + 1, numWorkers);
		}

		loggers.workerManager.info('Mediasoup workers initialized successfully');
	}

	getNextWorker(): mediasoup.types.Worker {
		const worker = this.workers[this.nextWorkerIndex];
		this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
		return worker;
	}

	getAllWorkers(): mediasoup.types.Worker[] {
		return this.workers;
	}

	async cleanup(): Promise<void> {
		loggers.workerManager.info('Closing %d workers', this.workers.length);
		for (const worker of this.workers) {
			try {
				worker.close();
			} catch (error) {
				loggers.workerManager.warn(
					'Error closing worker: %s',
					(error as Error).message,
				);
			}
		}
		this.workers = [];
		this.nextWorkerIndex = 0;
	}
}
