# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json
import time

import frappe
import jwt
from frappe import _
from frappe.rate_limiter import rate_limit


@frappe.whitelist()
@rate_limit(limit=10, seconds=60 * 60)
def create(meeting_type: str = "open") -> str:
	"""Create a new meeting with specified type"""
	meeting = frappe.get_doc(
		{
			"doctype": "Sae Meeting",
			"meeting_type": meeting_type,
		}
	).insert()

	return meeting.name


@frappe.whitelist()
def get_sfu_connection_details(meeting_id: str) -> dict:
	"""
	Get SFU connection details for direct client-to-SFU communication
	"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)

		if meeting.is_user_banned(frappe.session.user):
			frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

		if not meeting.can_join(frappe.session.user):
			frappe.throw(_("Access denied"), frappe.PermissionError)

		from sae.utils.sfu_config import get_sfu_config

		sfu_config = get_sfu_config()

		user_fullname, user_avatar = frappe.db.get_value(
			"User", frappe.session.user, ["full_name", "user_image"]
		) or (frappe.session.user, None)

		is_host = meeting.owner == frappe.session.user

		auth_payload = {
			"user_id": frappe.session.user,
			"meeting_id": meeting_id,
			"user_name": user_fullname,
			"user_avatar": user_avatar,
			"is_host": is_host,
			"scope": "full",
			"exp": int(time.time()) + 3600,  # 1 hour expiry
			"iat": int(time.time()),
		}

		secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key", "fallback-secret")
		auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

		return {
			"success": True,
			"sfu_url": sfu_config["sfu_server_url"],
			"sfu_port": sfu_config["sfu_server_port"],
			"auth_token": auth_token,
			"user_id": frappe.session.user,
			"meeting_id": meeting_id,
			"user_data": {
				"name": user_fullname,
				"email": frappe.session.user,
				"avatar": user_avatar,
			},
			"expires_in": 3600,
		}
	except Exception as e:
		frappe.log_error(f"Failed to get SFU connection details for meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def join_meeting(meeting_id: str) -> dict:
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)

		if meeting.is_user_banned(frappe.session.user):
			frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

		if meeting.can_join(frappe.session.user):
			result = meeting.join(frappe.session.user)

			if isinstance(result, dict):
				if result.get("status") == "waiting_for_approval":
					return {
						"success": True,
						"status": "waiting_for_approval",
						"meeting_id": meeting_id,
						"message": result.get("message", "Waiting for host approval"),
					}
				elif result.get("status") == "joined":
					return {
						"success": True,
						"status": "joined",
						"meeting_id": meeting_id,
						"message": result.get("message", "Successfully joined meeting"),
					}
		else:
			return {"success": False, "error": "Access denied"}
	except Exception as e:
		frappe.log_error(f"Failed to join meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def leave_meeting(meeting_id: str) -> dict:
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)
		meeting.leave(frappe.session.user)

		return {"success": True, "meeting_id": meeting_id, "user_id": frappe.session.user}
	except Exception as e:
		frappe.log_error(f"Failed to leave meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def cleanup_user_meetings(user_id: str | None = None) -> dict:
	"""
	Cleanup all meetings for a user (called when user disconnects)
	"""
	try:
		if not user_id:
			user_id = frappe.session.user

		# Find all active meetings for this user
		meetings = frappe.get_all("Sae Meeting", filters={"status": "Active"}, fields=["name"])

		cleaned_meetings = []

		for meeting in meetings:
			meeting_doc = frappe.get_doc("Sae Meeting", meeting.name)
			if user_id in meeting_doc.get_members():
				try:
					# Leave the meeting
					meeting_doc.leave(user_id)
					cleaned_meetings.append(meeting.name)
					frappe.logger().info(f"Cleaned up user {user_id} from meeting {meeting.name}")
				except Exception as e:
					frappe.logger().error(
						f"Error cleaning up user {user_id} from meeting {meeting.name}: {e!s}"
					)

		return {"success": True, "cleaned_meetings": cleaned_meetings, "user_id": user_id}
	except Exception as e:
		frappe.log_error(f"Error in user meeting cleanup: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def approve_join_request(meeting_id: str, user_id: str) -> dict:
	"""Approve a user's join request from waiting room"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)
		meeting.approve_user(user_id)

		return {
			"success": True,
			"meeting_id": meeting_id,
			"user_id": user_id,
			"message": "User approved successfully",
		}
	except Exception as e:
		frappe.log_error(f"Failed to approve join request for meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def reject_join_request(meeting_id: str, user_id: str) -> dict:
	"""Reject a user's join request from waiting room"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)
		meeting.reject_user(user_id)

		return {
			"success": True,
			"meeting_id": meeting_id,
			"user_id": user_id,
			"message": "User rejected successfully",
		}
	except Exception as e:
		frappe.log_error(f"Failed to reject join request for meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_waiting_room(meeting_id: str) -> dict:
	"""Get list of users waiting for approval"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)

		if frappe.session.user != meeting.owner:
			return {"success": False, "error": "Access denied"}

		waiting_users = meeting.get_waiting_room()

		user_details = []
		for user in waiting_users:
			user_info = frappe.get_value("User", user, ["full_name", "user_image"], as_dict=True)
			user_details.append(
				{
					"user_id": user,
					"full_name": user_info.get("full_name") if user_info else user,
					"user_image": user_info.get("user_image") if user_info else None,
				}
			)

		return {"success": True, "meeting_id": meeting_id, "waiting_users": user_details}
	except Exception as e:
		frappe.log_error(f"Failed to get waiting room for meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_meeting_info(meeting_id: str) -> dict:
	"""Get meeting information including type and permissions"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)

		return {
			"success": True,
			"meeting_id": meeting_id,
			"meeting_type": meeting.meeting_type,
			"owner": meeting.owner,
			"is_creator": frappe.session.user == meeting.owner,
			"is_active": meeting.is_active,
			"member_count": len(meeting.get_members()),
			"waiting_count": len(meeting.get_waiting_room()) if meeting.meeting_type == "restricted" else 0,
		}
	except Exception as e:
		frappe.log_error(f"Failed to get meeting info for {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def refresh_sfu_token(meeting_id: str) -> dict:
	"""
	Refresh SFU authentication token for ongoing meetings
	"""
	try:
		meeting = frappe.get_doc("Sae Meeting", meeting_id)

		if not meeting.is_active:
			return {"success": False, "error": "Meeting has ended"}

		if frappe.session.user not in meeting.get_members():
			return {"success": False, "error": "Not a meeting member"}

		from sae.utils.sfu_config import get_sfu_config

		sfu_config = get_sfu_config()

		user_fullname, user_avatar = frappe.db.get_value(
			"User", frappe.session.user, ["full_name", "user_image"]
		) or (frappe.session.user, None)

		is_host = meeting.owner == frappe.session.user

		auth_payload = {
			"user_id": frappe.session.user,
			"meeting_id": meeting_id,
			"user_name": user_fullname,
			"user_avatar": user_avatar,
			"is_host": is_host,
			"exp": int(time.time()) + 3600,  # 1 hour expiry
			"iat": int(time.time()),
		}

		secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key", "fallback-secret")
		auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

		return {
			"success": True,
			"auth_token": auth_token,
			"expires_in": 3600,
		}
	except Exception as e:
		frappe.log_error(f"Failed to refresh SFU token for meeting {meeting_id}: {e!s}")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_sfu_presence_preview_token(meeting_id: str) -> dict:
	"""Get a short-lived SFU token scoped for presence preview only.

	This is used by the meeting preview page to fetch live participants
	from the SFU without granting any media capabilities.
	"""
	meeting = frappe.get_doc("Sae Meeting", meeting_id)

	if meeting.is_user_banned(frappe.session.user):
		frappe.throw(_("You are banned from this meeting"), frappe.PermissionError)

	if not meeting.can_join(frappe.session.user):
		frappe.throw(_("Access denied"), frappe.PermissionError)

	import uuid

	from sae.utils.sfu_config import get_sfu_config

	sfu_config = get_sfu_config()

	expiry_seconds = 300
	now = int(time.time())
	session_id = str(uuid.uuid4())

	auth_payload = {
		"user_id": frappe.session.user,
		"meeting_id": meeting_id,
		"scope": "presence-preview",
		"session_id": session_id,
		"exp": now + expiry_seconds,
		"iat": now,
	}

	secret = sfu_config.get("sfu_secret") or frappe.conf.get("secret_key", "fallback-secret")
	auth_token = jwt.encode(auth_payload, secret, algorithm="HS256")

	result = {
		"success": True,
		"sfu_url": sfu_config["sfu_server_url"],
		"sfu_port": sfu_config.get("sfu_server_port"),
		"auth_token": auth_token,
		"expires_in": expiry_seconds,
	}

	return result
