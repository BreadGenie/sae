import type { Socket } from 'socket.io';
import type { UserData } from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps, SocketHandler } from './Handler';
import { getRoomId, isRealParticipant } from './utils';

export class RoomJoinHandlers implements SocketHandler {
	constructor(private deps: HandlerDeps) {}

	register(socket: Socket): void {
		socket.on('join_room', async (data, callback) => {
			try {
				const { roomId, userData, mediaState } = data;
				await this.handleJoinRoom(socket, {
					roomId,
					participantId: socket.userId,
					userData: {
						name: userData.name,
						userId: userData.userId,
						avatar: userData.avatar,
						audio_enabled: mediaState.audio_enabled,
						video_enabled: mediaState.video_enabled,
						is_guest: userData.is_guest,
					},
				});
				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error joining room: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('leave_room', async (data = {}) => {
			const roomId =
				socket.roomId || (data.roomId ? getRoomId(socket) : undefined);
			const participantId = socket.participantId;
			if (roomId && participantId) {
				try {
					await this.deps.mediasoup.removePeer(roomId, participantId);

					if (isRealParticipant(participantId)) {
						socket
							.to(roomId)
							.emit('participant_left', { roomId, participantId });
					}

					if (this.deps.registry.hasRaisedHand(roomId, participantId)) {
						this.deps.registry.clearRaisedHand(roomId, participantId);
						this.deps.registry.emitToFullAccessParticipants(
							roomId,
							'hand_raised',
							{
								participantId,
								raised: false,
								timestamp: new Date().toISOString(),
							},
						);
					}

					socket.leave(roomId);
					socket.roomId = undefined;
					loggers.socketHandler.info('%s left room %s', participantId, roomId);
				} catch (e) {
					loggers.socketHandler.warn(
						'leave_room cleanup failed: %s',
						(e as Error).message,
					);
				}
			}
		});
	}

	private async handleJoinRoom(
		socket: Socket,
		data: { roomId: string; participantId: string; userData: UserData },
	): Promise<void> {
		const { roomId, participantId, userData } = data;

		try {
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			const scopedRoomId = getRoomId(socket);

			await this.deps.mediasoup.createRoom(
				scopedRoomId,
				(roomIdInner, participantIds) => {
					this.deps.registry.emitToFullAccessParticipants(
						roomIdInner,
						'active_speaker',
						{ participantIds },
					);
				},
			);

			socket.join(scopedRoomId);

			if (!socket.meetingId) {
				socket.meetingId = roomId;
			}
			socket.roomId = scopedRoomId;
			socket.participantId = participantId;

			if (socket.scope === 'full') {
				this.deps.registry.addFullAccessSocket(scopedRoomId, socket.id);
				this.deps.mediasoup.addPeer(scopedRoomId, participantId, userData);

				if (isRealParticipant(userData.userId)) {
					this.deps.registry.emitParticipantEvent(
						scopedRoomId,
						'participant_joined',
						participantId,
						userData,
					);
				}

				loggers.socketHandler.info(
					'User %s joined room %s with media state: audio=%s, video=%s',
					participantId,
					scopedRoomId,
					userData.audio_enabled,
					userData.video_enabled,
				);
			} else if (socket.scope === 'presence-preview') {
				this.deps.registry.addPreviewSocket(scopedRoomId, socket.id);

				loggers.socketHandler.info(
					'Preview user %s observing room %s (not added as peer)',
					participantId,
					scopedRoomId,
				);
			}

			socket.emit('existing_raised_hands', {
				hands: this.deps.registry.getRaisedHands(
					scopedRoomId,
				) as unknown as Record<string, boolean>,
			});
		} catch (error) {
			loggers.socketHandler.error(
				'Error in handleJoinRoom for user %s: %s',
				participantId,
				(error as Error).message,
			);
			throw error;
		}
	}
}
