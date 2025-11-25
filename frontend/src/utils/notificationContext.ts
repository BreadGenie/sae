/**
 * Notification Context Manager
 * Determines when to play notification sounds based on user context
 */

interface NotificationContext {
	isTabVisible: boolean;
	isChatOpen: boolean;
	isScreenSharing: boolean;
	lastNotificationTime: Record<string, number>;
}

class NotificationContextManager {
	private context: NotificationContext = {
		isTabVisible: true,
		isChatOpen: false,
		isScreenSharing: false,
		lastNotificationTime: {},
	};

	private readonly MIN_NOTIFICATION_INTERVAL = 5000; // 5 seconds between same type

	constructor() {
		this.setupVisibilityListener();
	}

	private setupVisibilityListener() {
		document.addEventListener("visibilitychange", () => {
			this.context.isTabVisible = !document.hidden;
		});
	}

	updateChatState(isOpen: boolean) {
		this.context.isChatOpen = isOpen;
	}

	updateScreenShareState(isSharing: boolean) {
		this.context.isScreenSharing = isSharing;
	}

	shouldPlayNotification(
		type: "join" | "leave" | "chat" | "joinRequest",
		options?: { isLocalUser?: boolean },
	): boolean {
		const now = Date.now();

		const lastTime = this.context.lastNotificationTime[type] || 0;
		if (now - lastTime < this.MIN_NOTIFICATION_INTERVAL) {
			return false;
		}

		// only play for local user leaving
		if (type === "leave") {
			if (options?.isLocalUser) {
				this.context.lastNotificationTime[type] = now;
				return true;
			}
			return false;
		}

		// suppress join noise when screen sharing
		if (type === "join") {
			if (this.context.isScreenSharing) {
				return false;
			}

			this.context.lastNotificationTime[type] = now;
			return true;
		}

		// suppress chat sounds when chat is open
		if (type === "chat") {
			if (this.context.isChatOpen) {
				return false;
			}

			this.context.lastNotificationTime[type] = now;
			return true;
		}

		// join request sounds are important
		if (type === "joinRequest") {
			this.context.lastNotificationTime[type] = now;
			return true;
		}

		return false;
	}
}

export const notificationContextManager = new NotificationContextManager();
export default notificationContextManager;
