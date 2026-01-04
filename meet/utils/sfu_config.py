# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe


def get_sfu_config():
	"""Get SFU configuration from site config or defaults"""
	return {
		"sfu_server_url": frappe.conf.get("sfu_server_url", "http://localhost"),
		"sfu_server_port": frappe.conf.get("sfu_server_port", 3000),
		"sfu_api_key": frappe.conf.get("sfu_api_key", ""),
		"sfu_secret": frappe.conf.get("sfu_secret", ""),
		"sfu_timeout": frappe.conf.get("sfu_timeout", 30),
		"sfu_reconnect_attempts": frappe.conf.get("sfu_reconnect_attempts", 5),
		"sfu_reconnect_delay": frappe.conf.get("sfu_reconnect_delay", 1),
		"enable_sfu_logging": frappe.conf.get("enable_sfu_logging", False),
	}


def validate_sfu_config():
	"""Validate SFU configuration"""
	config = get_sfu_config()

	required_fields = ["sfu_server_url", "sfu_server_port"]
	missing_fields = []

	for field in required_fields:
		if not config.get(field):
			missing_fields.append(field)

	if missing_fields:
		frappe.throw(f"Missing SFU configuration fields: {', '.join(missing_fields)}")

	return config


# Media constraints for different quality levels
MEDIA_CONSTRAINTS = {
	"low": {
		"video": {"width": {"max": 640}, "height": {"max": 480}, "frameRate": {"max": 15}},
		"audio": {"echoCancellation": True, "noiseSuppression": True, "autoGainControl": True},
	},
	"medium": {
		"video": {"width": {"max": 1280}, "height": {"max": 720}, "frameRate": {"max": 30}},
		"audio": {"echoCancellation": True, "noiseSuppression": True, "autoGainControl": True},
	},
	"high": {
		"video": {"width": {"max": 1920}, "height": {"max": 1080}, "frameRate": {"max": 30}},
		"audio": {"echoCancellation": True, "noiseSuppression": True, "autoGainControl": True},
	},
}


def get_media_constraints(quality="medium"):
	"""Get media constraints for specified quality level"""
	return MEDIA_CONSTRAINTS.get(quality, MEDIA_CONSTRAINTS["medium"])
