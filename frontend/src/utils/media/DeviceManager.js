/**
 * Device Management Utilities
 */

export class DeviceManager {
	constructor() {
		this.cameras = [];
		this.microphones = [];
		this.speakers = [];
		this.isEnumerating = false;
		this.deviceChangeListeners = [];
		this.setupDeviceChangeListener();
	}

	async enumerateDevices() {
		if (this.isEnumerating) return;

		try {
			this.isEnumerating = true;

			try {
				await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
			} catch (error) {
				console.warn(
					"Could not get media permissions for device enumeration:",
					error,
				);
			}

			const devices = await navigator.mediaDevices.enumerateDevices();

			this.cameras = devices
				.filter((device) => device.kind === "videoinput")
				.map((device, index) => ({
					deviceId: device.deviceId,
					label: device.label || `Camera ${index + 1}`,
					groupId: device.groupId,
				}));

			this.microphones = devices
				.filter((device) => device.kind === "audioinput")
				.map((device, index) => ({
					deviceId: device.deviceId,
					label: device.label || `Microphone ${index + 1}`,
					groupId: device.groupId,
				}));

			this.speakers = devices
				.filter((device) => device.kind === "audiooutput")
				.map((device) => ({
					deviceId: device.deviceId,
					label: device.label || `Speaker ${this.speakers.length + 1}`,
					groupId: device.groupId,
				}));
		} catch (error) {
			console.error("❌ Failed to enumerate devices:", error);
			throw error;
		} finally {
			this.isEnumerating = false;
		}
	}

	getCameras() {
		return this.cameras;
	}

	getMicrophones() {
		return this.microphones;
	}

	getSpeakers() {
		return this.speakers;
	}

	findDeviceById(deviceId, deviceType) {
		const devices =
			deviceType === "camera"
				? this.cameras
				: deviceType === "microphone"
					? this.microphones
					: this.speakers;
		return devices.find((device) => device.deviceId === deviceId);
	}

	getDefaultDevice(deviceType) {
		const devices =
			deviceType === "camera"
				? this.cameras
				: deviceType === "microphone"
					? this.microphones
					: this.speakers;
		return devices.length > 0 ? devices[0] : null;
	}

	isDeviceAvailable(deviceId, deviceType) {
		return this.findDeviceById(deviceId, deviceType) !== undefined;
	}

	setupDeviceChangeListener() {
		if (navigator.mediaDevices?.addEventListener) {
			navigator.mediaDevices.addEventListener("devicechange", () => {
				console.log("📱 Device change detected, re-enumerating devices...");
				this.enumerateDevices()
					.then(() => {
						for (const listener of this.deviceChangeListeners) {
							try {
								listener();
							} catch (error) {
								console.error("Error in device change listener:", error);
							}
						}
					})
					.catch((error) => {
						console.error("Failed to re-enumerate devices on change:", error);
					});
			});
		}
	}

	addDeviceChangeListener(listener) {
		this.deviceChangeListeners.push(listener);
	}

	removeDeviceChangeListener(listener) {
		const index = this.deviceChangeListeners.indexOf(listener);
		if (index > -1) {
			this.deviceChangeListeners.splice(index, 1);
		}
	}
}

export const deviceManager = new DeviceManager();
