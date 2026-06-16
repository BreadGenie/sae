import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';

export class ConsumerHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('create_consumer', async (data, callback) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
				const { transportId, producerId, rtpCapabilities } = data;
				const consumer = await this.deps.mediasoup.createConsumer(
					transportId,
					producerId,
					rtpCapabilities,
				);

				callback({ success: true, ...consumer });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_consumer', async (data, callback) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
				const { consumerId } = data;
				await this.deps.mediasoup.closeConsumer(consumerId);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('consumer:update_preferences', async (data, callback) => {
			try {
				const consumerId = data?.consumerId;
				if (!consumerId) {
					callback({ success: false, error: 'Missing consumerId' });
					return;
				}

				const visible = Boolean(data.visible);
				const width = Math.round(data.width);
				const height = Math.round(data.height);

				const result = await this.deps.mediasoup.updateConsumerPreferences({
					consumerId,
					visible,
					width,
					height,
				});

				callback({ success: true, ...result, visible });
			} catch (error) {
				loggers.socketHandler.warn(
					'Error updating consumer preferences: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	}
}
