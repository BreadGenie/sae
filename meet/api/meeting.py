# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json
import secrets
import time
from typing import TYPE_CHECKING

import frappe
import jwt
from frappe import _
from frappe.rate_limiter import rate_limit

from meet.utils.sfu_config import get_sfu_config
from meet.utils.user import (
	get_guest_session,
	get_user_info,
	set_guest_session,
	validate_guest_name,
)

if TYPE_CHECKING:
	from meet.meet.doctype.sae_meeting.sae_meeting import SaeMeeting


def _get_codec_strategy() -> str:
	return frappe.get_cached_doc("Sae Settings").codec_strategy or "svc"


@frappe.whitelist()
@rate_limit(limit=10, seconds=60 * 60)
def create(meeting_type: str = "open", allow_guest: bool = True) -> str:
	"""Create a new meeting with specified type"""
	global_settings = frappe.get_cached_doc("Sae Settings")
	if not global_settings.allow_guest:
		allow_guest = False

	meeting: SaeMeeting = frappe.get_doc(
		{
			"doctype": "Sae Meeting",
			"meeting_type": meeting_type,
			"allow_guest": allow_guest,
		}
	).insert()

	return meeting.name


@frappe.whitelist()
def get_sfu_connection_details(meeting_id: str) -> dict:
	"""
	Get SFU connection details for direct client-to-SFU communication
	"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if meeting.is_user_banned(frappe.session.user):
		frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

	if not meeting.can_join(frappe.session.user):
		frappe.throw(_("Access denied"), frappe.PermissionError)

	from meet.utils.sfu_config import get_sfu_config

	sfu_config = get_sfu_config()

	user_fullname, user_avatar = frappe.db.get_value(
		"User", frappe.session.user, ["full_name", "user_image"]
	) or (frappe.session.user, None)

	is_host = meeting.owner == frappe.session.user
	is_cohost = meeting.is_host_or_cohost(frappe.session.user) and not is_host

	auth_payload = {
		"user_id": frappe.session.user,
		"meeting_id": meeting_id,
		"user_name": user_fullname,
		"user_avatar": user_avatar,
		"is_host": is_host,
		"is_cohost": is_cohost,
		"scope": "full",
		"exp": int(time.time()) + 3600,  # 1 hour expiry
		"iat": int(time.time()),
	}

	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))
	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	return {
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config["sfu_server_port"],
		"auth_token": auth_token,
		"user_id": frappe.session.user,
		"meeting_id": meeting_id,
		"codec_strategy": _get_codec_strategy(),
		"user_data": {
			"name": user_fullname,
			"email": frappe.session.user,
			"avatar": user_avatar,
		},
		"expires_in": 3600,
	}


@frappe.whitelist()
def join_meeting(meeting_id: str) -> dict:
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if meeting.is_user_banned(frappe.session.user):
		frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

	if meeting.can_join(frappe.session.user):
		result = meeting.join(frappe.session.user)

		if isinstance(result, dict):
			if result.get("status") == "waiting_for_approval":
				sfu_config = get_sfu_config()

				user_fullname, user_avatar = frappe.db.get_value(
					"User", frappe.session.user, ["full_name", "user_image"]
				) or (frappe.session.user, None)

				lobby_payload = {
					"user_id": frappe.session.user,
					"meeting_id": meeting_id,
					"user_name": user_fullname,
					"user_avatar": user_avatar,
					"is_host": False,
					"is_guest": False,
					"scope": "presence-preview",
					"exp": int(time.time()) + 60 * 60,
					"iat": int(time.time()),
				}

				secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
				if not secret:
					frappe.throw(_("SFU secret not configured"))
				lobby_token = jwt.encode(lobby_payload, secret, algorithm="HS256")

				return {
					"status": "waiting_for_approval",
					"meeting_id": meeting_id,
					"message": result.get("message", "Waiting for host approval"),
					"lobby_token": lobby_token,
					"sfu_url": sfu_config["sfu_server_url"],
					"sfu_port": sfu_config["sfu_server_port"],
					"user_data": {
						"name": user_fullname,
						"avatar": user_avatar,
					},
				}
			elif result.get("status") == "joined":
				is_host = meeting.owner == frappe.session.user
				is_cohost = meeting.is_host_or_cohost(frappe.session.user) and not is_host
				return {
					"status": "joined",
					"meeting_id": meeting_id,
					"message": result.get("message", "Successfully joined meeting"),
					"is_host": is_host,
					"is_cohost": is_cohost,
				}
	else:
		frappe.throw(_("Access denied"))


@frappe.whitelist()
def approve_join_request(meeting_id: str, user_id: str) -> dict:
	"""Approve a user's join request from waiting room"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if not meeting.is_host_or_cohost(frappe.session.user):
		frappe.throw(_("Access denied"))

	meeting.approve_user(user_id)

	return {"meeting_id": meeting_id, "user_id": user_id, "message": "User approved successfully"}


@frappe.whitelist()
def approve_all_join_requests(meeting_id: str) -> dict:
	"""Approve all users' join requests from waiting room"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if not meeting.is_host_or_cohost(frappe.session.user):
		frappe.throw("Access denied")

	meeting.approve_all_users()

	return {"meeting_id": meeting_id, "message": "All users approved successfully"}


@frappe.whitelist()
def reject_join_request(meeting_id: str, user_id: str) -> dict:
	"""Reject a user's join request from waiting room"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if not meeting.is_host_or_cohost(frappe.session.user):
		frappe.throw(_("Access denied"))

	meeting.reject_user(user_id)

	# For guests, publish realtime event in a guest-specific room
	if user_id.startswith("guest_"):
		frappe.publish_realtime(
			"meet:guest_join_rejected",
			{"meeting_id": meeting_id, "guest_id": user_id},
			room=f"guest:{user_id}",
			after_commit=True,
		)

	return {"meeting_id": meeting_id, "user_id": user_id, "message": "User rejected successfully"}


@frappe.whitelist()
def get_waiting_room(meeting_id: str) -> dict:
	"""Get list of users waiting for approval"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if not meeting.is_host_or_cohost(frappe.session.user):
		frappe.throw(_("Access denied"))

	waiting_users = meeting.get_waiting_room()

	user_details = []
	for user in waiting_users:
		user_info = get_user_info(user)
		if user_info:
			user_details.append(
				{
					"user_id": user,
					"full_name": user_info.get("full_name"),
					"user_image": user_info.get("user_image"),
					"is_guest": user_info.get("is_guest", False),
				}
			)

	return {"meeting_id": meeting_id, "waiting_users": user_details}


@frappe.whitelist()
def refresh_sfu_token(meeting_id: str) -> dict:
	"""
	Refresh SFU authentication token for ongoing meetings
	"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if frappe.session.user not in meeting.get_members():
		frappe.throw(_("Not a meeting member"))

	from meet.utils.sfu_config import get_sfu_config

	sfu_config = get_sfu_config()

	user_fullname, user_avatar = frappe.db.get_value(
		"User", frappe.session.user, ["full_name", "user_image"]
	) or (frappe.session.user, None)

	is_host = meeting.owner == frappe.session.user
	is_cohost = meeting.is_host_or_cohost(frappe.session.user) and not is_host

	auth_payload = {
		"user_id": frappe.session.user,
		"meeting_id": meeting_id,
		"user_name": user_fullname,
		"user_avatar": user_avatar,
		"is_host": is_host,
		"is_cohost": is_cohost,
		"exp": int(time.time()) + 3600,  # 1 hour expiry
		"iat": int(time.time()),
	}

	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))
	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	return {"auth_token": auth_token, "expires_in": 3600, "codec_strategy": _get_codec_strategy()}


@frappe.whitelist()
def get_sfu_presence_preview_token(meeting_id: str) -> dict:
	"""Get a short-lived SFU token scoped for presence preview only.

	This is used by the meeting preview page to fetch live participants
	from the SFU without granting any media capabilities.
	"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)

	if meeting.is_user_banned(frappe.session.user):
		frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

	if not meeting.can_join(frappe.session.user):
		frappe.throw(_("Access denied"), frappe.PermissionError)

	sfu_config = get_sfu_config()

	expiry_seconds = 300
	now = int(time.time())
	session_id = str(secrets.token_urlsafe(16))

	auth_payload = {
		"user_id": frappe.session.user,
		"meeting_id": meeting_id,
		"scope": "presence-preview",
		"session_id": session_id,
		"exp": now + expiry_seconds,
		"iat": now,
	}

	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))
	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	result = {
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config.get("sfu_server_port"),
		"auth_token": auth_token,
		"expires_in": expiry_seconds,
	}

	return result


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=60 * 60)
def join_meeting_as_guest(meeting_id: str, guest_name: str, guest_id: str | None = None) -> dict:
	"""
	Allow guest users to join a meeting without authentication.
	Generates a guest session and JWT token for SFU access.
	"""
	is_valid, error_message = validate_guest_name(guest_name)
	if not is_valid:
		frappe.throw(_(error_message))

	if not frappe.db.exists("Sae Meeting", meeting_id):
		frappe.throw(_("Meeting not found"))

	meeting = frappe.get_doc("Sae Meeting", meeting_id)

	global_settings = frappe.get_cached_doc("Sae Settings")
	if not global_settings.allow_guest or not meeting.allow_guest:
		frappe.throw(_("Guests are not allowed in this meeting"))
	# Check if reusing existing guest_id
	if guest_id:
		session_data = get_guest_session(guest_id)
		if session_data and session_data.get("meeting_id") == meeting_id:
			# Reuse existing guest_id
			guest_name_clean = session_data.get("guest_name", guest_name.strip())
		else:
			# Invalid or expired, generate new
			guest_id = None

	if not guest_id:
		guest_id = f"guest_{secrets.token_urlsafe(16)}"
		guest_name_clean = guest_name.strip()

		session_data = {
			"guest_id": guest_id,
			"guest_name": guest_name_clean,
			"meeting_id": meeting_id,
			"ip_address": frappe.local.request_ip,
			"joined_at": int(time.time()),
		}
		set_guest_session(guest_id, session_data, ttl=24 * 3600)

	if meeting.is_user_banned(guest_id):
		frappe.throw(_("You are banned from this meeting"))

	sfu_config = get_sfu_config()
	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))

	auth_payload = {
		"user_id": guest_id,
		"user_name": guest_name_clean,
		"meeting_id": meeting_id,
		"is_host": False,
		"is_guest": True,
		"scope": "full",
		"exp": int(time.time()) + 24 * 3600,
		"iat": int(time.time()),
	}

	if meeting.meeting_type == "restricted":
		if meeting.is_user_approved(guest_id):
			auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")
			return {
				"status": "joined",
				"meeting_id": meeting_id,
				"guest_id": guest_id,
				"guest_name": guest_name_clean,
				"auth_token": auth_token,
				"sfu_url": sfu_config["sfu_server_url"],
				"sfu_port": sfu_config["sfu_server_port"],
				"message": "Successfully joined meeting",
			}
		elif guest_id not in meeting.get_waiting_room():
			meeting.add_guest_to_waiting_room(guest_id)

		return {
			"status": "waiting_for_approval",
			"meeting_id": meeting_id,
			"guest_id": guest_id,
			"guest_name": guest_name_clean,
			"message": "Waiting for host approval",
		}

	# open meeting
	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	meeting.add_guest_to_members(guest_id)

	return {
		"status": "joined",
		"meeting_id": meeting_id,
		"guest_id": guest_id,
		"guest_name": guest_name_clean,
		"auth_token": auth_token,
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config["sfu_server_port"],
		"message": "Successfully joined meeting",
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=60 * 60)
def get_approved_guest_connection_details(meeting_id: str, guest_id: str) -> dict:
	"""
	Get SFU connection details for an approved guest.
	This is called after a guest receives approval notification.
	"""
	session_data = get_guest_session(guest_id)
	if not session_data:
		frappe.throw(_("Guest session not found or expired"))

	if not frappe.db.exists("Sae Meeting", meeting_id):
		frappe.throw(_("Meeting not found"))

	meeting = frappe.get_doc("Sae Meeting", meeting_id)

	if not meeting.is_user_approved(guest_id):
		frappe.throw(_("Guest not approved"))

	if meeting.is_user_banned(guest_id):
		frappe.throw(_("You are banned from this meeting"))

	sfu_config = get_sfu_config()
	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))

	guest_name = session_data.get("guest_name", f"Guest-{guest_id[:8]}")

	auth_payload = {
		"user_id": guest_id,
		"user_name": guest_name,
		"meeting_id": meeting_id,
		"is_host": False,
		"is_guest": True,
		"scope": "full",
		"exp": int(time.time()) + 24 * 3600,
		"iat": int(time.time()),
	}

	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	return {
		"status": "joined",
		"meeting_id": meeting_id,
		"guest_id": guest_id,
		"guest_name": guest_name,
		"auth_token": auth_token,
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config["sfu_server_port"],
		"message": "Successfully joined meeting",
	}


@frappe.whitelist(allow_guest=True)
def get_guest_sfu_connection_details(meeting_id: str, guest_token: str) -> dict:
	"""
	Get SFU connection details for guest users.
	Validates the guest token and returns SFU URL/port.
	"""
	sfu_config = get_sfu_config()
	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key")
	if not secret:
		frappe.throw(_("SFU secret not configured"))

	try:
		decoded = jwt.decode(guest_token, secret, algorithms=["HS256"])
	except jwt.ExpiredSignatureError:
		frappe.throw(_("Guest token has expired"))
	except jwt.InvalidTokenError:
		frappe.throw(_("Invalid guest token"))

	if not decoded.get("is_guest"):
		frappe.throw(_("Not a guest token"))

	if decoded.get("meeting_id") != meeting_id:
		frappe.throw(_("Token meeting ID does not match"))

	if not frappe.db.exists("Sae Meeting", meeting_id):
		frappe.throw(_("Meeting not found"))

	return {
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config["sfu_server_port"],
		"codec_strategy": _get_codec_strategy(),
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=60 * 60)
def validate_guest_session(guest_id: str) -> dict:
	"""
	Validate that a guest session exists and is active.

	Args:
		guest_id: The guest ID to validate

	Returns:
		dict: {"valid": bool}
	"""
	if not guest_id or not guest_id.startswith("guest_"):
		return {"valid": False, "error": "Invalid guest ID format"}

	session_data = get_guest_session(guest_id)
	if not session_data:
		return {"valid": False, "error": "Guest session not found"}

	return {
		"valid": True,
	}


@frappe.whitelist()
def promote_to_cohost(meeting_id: str, user_id: str) -> dict:
	"""
	Promote a user to co-host during an active meeting (host only)
	"""
	meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)
	return meeting.promote_to_cohost(frappe.session.user, user_id)


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=5 * 60)
def check_meeting_access(meeting_id: str) -> dict:
	"""
	Check if a meeting allows guest access without authentication

	Args:
		meeting_id: The meeting ID to check

	Returns:
		dict: Access information for the meeting
	"""
	try:
		meeting: SaeMeeting = frappe.get_doc("Sae Meeting", meeting_id)
		settings = frappe.get_cached_doc("Sae Settings")
		allow_guest = settings.allow_guest and meeting.allow_guest

		return {"allow_guest": allow_guest}
	except frappe.DoesNotExistError:
		frappe.throw(_("Meeting not found"))
	except Exception as e:
		frappe.throw(str(e))
