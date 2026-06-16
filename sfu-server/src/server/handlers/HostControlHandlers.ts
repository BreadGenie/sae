import type { Socket } from 'socket.io';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';
import { findSocketByParticipantId } from './utils';

export class HostControlHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('host_control', async (data) => {
			try {
				this.deps.authManager.ensureFullAccess(socket);
				const { action, targetParticipantId } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) {
					socket.emit('sfu_error', {
						error: 'Not in a room',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				if (!socket.isHost && !socket.isCohost) {
					socket.emit('sfu_error', {
						error: 'Only host or co-host can control participants',
						timestamp: new Date().toISOString(),
					});
					loggers.socketHandler.warn(
						'Non-host/co-host %s attempted host control in room %s',
						socket.participantId,
						roomId,
					);
					return;
				}

				if (
					!this.deps.mediasoup.peerExistsInRoom(roomId, targetParticipantId)
				) {
					socket.emit('sfu_error', {
						error: 'Target participant not found',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				const targetSocket = findSocketByParticipantId(
					this.deps.io,
					roomId,
					targetParticipantId,
				);

				if (!targetSocket) {
					socket.emit('sfu_error', {
						error: 'Target participant socket not found',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				switch (action) {
					case 'mute_participant':
						targetSocket.emit('host_control_update', {
							action,
							targetParticipantId,
							hostId: socket.participantId,
							timestamp: new Date().toISOString(),
						});
						loggers.socketHandler.info(
							'Host %s sent mute command to participant %s in room %s',
							socket.participantId,
							targetParticipantId,
							roomId,
						);
						break;
					case 'kick_participant':
						targetSocket.emit('host_control_update', {
							action,
							targetParticipantId,
							hostId: socket.participantId,
							timestamp: new Date().toISOString(),
						});

						loggers.socketHandler.info(
							'Host %s kicked participant %s from room %s',
							socket.participantId,
							targetParticipantId,
							roomId,
						);

						setTimeout(() => {
							if (targetSocket.connected) {
								targetSocket.disconnect(true);
								loggers.socketHandler.info(
									'Forcefully disconnected kicked participant %s',
									targetParticipantId,
								);
							}
						}, 1000);
						break;
					case 'lower_hand':
						if (this.deps.registry.hasRaisedHand(roomId, targetParticipantId)) {
							this.deps.registry.clearRaisedHand(roomId, targetParticipantId);
							this.deps.registry.emitToFullAccessParticipants(
								roomId,
								'hand_raised',
								{
									participantId: targetParticipantId,
									raised: false,
									timestamp: new Date().toISOString(),
								},
							);
							loggers.socketHandler.info(
								'Host %s lowered hand of participant %s',
								socket.participantId,
								targetParticipantId,
							);
						} else {
							socket.emit('sfu_error', {
								error: 'Participant does not have a raised hand',
								timestamp: new Date().toISOString(),
							});
						}
						break;
					default:
						socket.emit('sfu_error', {
							error: 'Invalid host control action',
							timestamp: new Date().toISOString(),
						});
						break;
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'host_control handling failed: %s',
					(error as Error).message,
				);
				socket.emit('sfu_error', {
					error: (error as Error).message,
					timestamp: new Date().toISOString(),
				});
			}
		});
	}
}
