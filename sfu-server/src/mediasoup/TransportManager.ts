import type * as mediasoup from 'mediasoup';
import type {
	DtlsParameters,
	IceCandidate,
	IceParameters,
	TransportData,
	WebRTCTransportOptions,
	WebRtcTransport,
} from '../types';
import { loggers } from '../utils/logger';

export class TransportManager {
	private transports = new Map<string, TransportData>();

	async createWebRtcTransport(
		roomId: string,
		peerId: string,
		router: mediasoup.types.Router,
		direction: 'send' | 'recv',
		options: WebRTCTransportOptions,
	): Promise<{
		id: string;
		iceParameters: IceParameters;
		iceCandidates: IceCandidate[];
		dtlsParameters: DtlsParameters;
	}> {
		loggers.transportManager.info(
			'Creating %s transport for peer %s',
			direction,
			peerId,
		);

		const transport = await router.createWebRtcTransport(options);

		const _transportKey = `${direction}-${Date.now()}`;
		const transportData: TransportData = {
			roomId,
			peerId,
			transport,
		};
		this.transports.set(transport.id, transportData);

		loggers.transportManager.info(
			'%s transport created for peer %s',
			direction,
			peerId,
		);

		return {
			id: transport.id,
			iceParameters: transport.iceParameters,
			iceCandidates: transport.iceCandidates,
			dtlsParameters: transport.dtlsParameters,
		};
	}

	async connectWebRtcTransport(
		transportId: string,
		dtlsParameters: DtlsParameters,
	): Promise<void> {
		const transportData = this.transports.get(transportId);
		if (!transportData) {
			throw new Error(`Transport ${transportId} not found`);
		}

		try {
			await transportData.transport.connect({ dtlsParameters });
		} catch (error) {
			loggers.transportManager.error(
				'Failed to connect transport %s: %s',
				transportId,
				(error as Error).message,
			);
			loggers.transportManager.error('Transport state on error: %o', {
				id: transportData.transport.id,
				iceState: transportData.transport.iceState,
				dtlsState: transportData.transport.dtlsState,
			});
			throw error;
		}
	}

	getTransport(transportId: string): WebRtcTransport | undefined {
		return this.transports.get(transportId)?.transport;
	}

	getTransportData(transportId: string): TransportData | undefined {
		return this.transports.get(transportId);
	}

	removeTransport(transportId: string): void {
		this.transports.delete(transportId);
	}

	getTransportCount(): number {
		return this.transports.size;
	}

	cleanup(): void {
		for (const [transportId, transportData] of this.transports) {
			try {
				transportData.transport.close();
			} catch (error) {
				loggers.transportManager.warn(
					'Error closing transport %s: %s',
					transportId,
					(error as Error).message,
				);
			}
		}
		this.transports.clear();
	}
}
