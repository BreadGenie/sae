/**
 * Waiting Room Manager
 * Handles waiting room functionality and join request management
 */

import { createResource, toast } from "frappe-ui";

export class WaitingRoomManager {
	constructor() {
		this.waitingUsers = [];
		this.loadingUsers = [];
		this.isWaitingForApproval = false;
		this.isJoinRequestRejected = false;
		this.eventHandlers = {};
		this.meetingId = null;
	}

	initialize(meetingId, eventHandlers = {}) {
		this.meetingId = meetingId;
		this.eventHandlers = eventHandlers;
		this.setupAPIResources();
	}

	setupAPIResources() {
		this.getWaitingRoomResource = createResource({
			url: "sae.api.meeting.get_waiting_room",
			makeParams: () => ({ meeting_id: this.meetingId }),
			onSuccess: (data) => {
				this.updateWaitingRoom(data);
			},
			onError: (error) => {
				console.error("❌ Failed to get waiting room:", error);
			},
		});

		this.approveJoinRequestResource = createResource({
			url: "sae.api.meeting.approve_join_request",
			onSuccess: (data) => {
				if (this.eventHandlers.onUserApproved) {
					this.eventHandlers.onUserApproved(data);
				}
			},
			onError: (error) => {
				toast.error(error.message || "Failed to approve user");
				console.error("❌ Failed to approve user:", error);
			},
		});

		this.rejectJoinRequestResource = createResource({
			url: "sae.api.meeting.reject_join_request",
			onSuccess: (data) => {
				if (this.eventHandlers.onUserRejected) {
					this.eventHandlers.onUserRejected(data);
				}
			},
			onError: (error) => {
				toast.error(error.message || "Failed to reject user");
				console.error("❌ Failed to reject user:", error);
			},
		});
	}

	async getWaitingRoom() {
		try {
			await this.getWaitingRoomResource.submit();
			return this.waitingUsers;
		} catch (error) {
			console.error("❌ Failed to get waiting room:", error);
			throw error;
		}
	}

	updateWaitingRoom(data) {
		if (data?.waiting_users) {
			this.waitingUsers = data.waiting_users;

			if (this.eventHandlers.onWaitingRoomUpdated) {
				this.eventHandlers.onWaitingRoomUpdated(this.waitingUsers);
			}
		}
	}

	async approveUser(userId) {
		if (this.loadingUsers.includes(userId)) {
			console.warn("⚠️ User approval already in progress:", userId);
			return;
		}

		this.loadingUsers.push(userId);

		try {
			await this.approveJoinRequestResource.submit({
				meeting_id: this.meetingId,
				user_id: userId,
			});

			this.waitingUsers = this.waitingUsers.filter((u) => u.user_id !== userId);

			if (this.eventHandlers.onWaitingRoomUpdated) {
				this.eventHandlers.onWaitingRoomUpdated(this.waitingUsers);
			}

			if (this.eventHandlers.onUserApprovedLocally) {
				this.eventHandlers.onUserApprovedLocally(userId);
			}
		} catch (error) {
			console.error("❌ Failed to approve user:", error);
			throw error;
		} finally {
			this.loadingUsers = this.loadingUsers.filter((id) => id !== userId);
		}
	}

	async rejectUser(userId) {
		if (this.loadingUsers.includes(userId)) {
			console.warn("⚠️ User rejection already in progress:", userId);
			return;
		}

		this.loadingUsers.push(userId);

		try {
			await this.rejectJoinRequestResource.submit({
				meeting_id: this.meetingId,
				user_id: userId,
			});

			this.waitingUsers = this.waitingUsers.filter((u) => u.user_id !== userId);

			if (this.eventHandlers.onWaitingRoomUpdated) {
				this.eventHandlers.onWaitingRoomUpdated(this.waitingUsers);
			}

			if (this.eventHandlers.onUserRejectedLocally) {
				this.eventHandlers.onUserRejectedLocally(userId);
			}
		} catch (error) {
			console.error("❌ Failed to reject user:", error);
			throw error;
		} finally {
			this.loadingUsers = this.loadingUsers.filter((id) => id !== userId);
		}
	}

	addWaitingUser(userData) {
		const existingUser = this.waitingUsers.find(
			(u) => u.user_id === userData.user_id,
		);
		if (!existingUser) {
			this.waitingUsers.push(userData);

			if (this.eventHandlers.onUserWaiting) {
				this.eventHandlers.onUserWaiting(userData);
			}

			if (this.eventHandlers.onWaitingRoomUpdated) {
				this.eventHandlers.onWaitingRoomUpdated(this.waitingUsers);
			}
		}
	}

	removeWaitingUser(userId) {
		const initialCount = this.waitingUsers.length;
		this.waitingUsers = this.waitingUsers.filter((u) => u.user_id !== userId);

		if (this.waitingUsers.length < initialCount) {
			if (this.eventHandlers.onUserLeftWaiting) {
				this.eventHandlers.onUserLeftWaiting(userId);
			}
		}
	}

	isUserLoading(userId) {
		return this.loadingUsers.includes(userId);
	}

	reset() {
		this.waitingUsers = [];
		this.loadingUsers = [];
		this.isWaitingForApproval = false;
		this.isJoinRequestRejected = false;
	}

	cleanup() {
		this.reset();
		this.eventHandlers = {};
		this.meetingId = null;
	}
}
