# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt


import re
import secrets

import frappe
from frappe.core.doctype.user.user import User


def unique_users(user_list: list) -> list[dict]:
	"""Return unique child table rows, preserving order and metadata."""
	seen = set()
	unique_list = []

	for user in user_list or []:
		if isinstance(user, str):
			user_id = user
			user_row = {"user": user_id}
		else:
			user_id = user.get("user") if hasattr(user, "get") else getattr(user, "user", None)
			if not user_id:
				continue
			user_row = dict(user) if isinstance(user, dict) else user.as_dict()

		if user_id in seen:
			continue

		seen.add(user_id)
		unique_list.append(user_row)

	return unique_list


def assign_meet_role(user: User, method: str) -> None:
	"""Assign the "Meet User" role to a newly created User."""
	role_name = "Meet User"
	user_name = user.name

	if not user_name or user_name in ("Guest", "Administrator"):
		return

	if not frappe.db.exists("Role", role_name):
		frappe.get_doc({"doctype": "Role", "role_name": role_name}).insert(ignore_permissions=True)

	user_doc = frappe.get_doc("User", user_name)
	user_doc.append("roles", {"role": role_name})
	user_doc.save(ignore_permissions=True)


def is_guest_user(user_id: str) -> bool:
	"""Check if a user ID is a guest identifier."""
	return user_id.startswith("guest_")


def get_user_info(user_id: str) -> dict | None:
	"""
	Get user information for both authenticated users and guests.

	Returns dict with full_name, user_image, and is_guest flag.
	Returns None if user not found or guest session expired.
	"""
	if not user_id:
		return None

	if is_guest_user(user_id):
		guest_session = get_guest_session(user_id)
		if not guest_session:
			return None

		return {
			"full_name": guest_session.get("guest_name"),
			"is_guest": True,
		}

	user_info = frappe.db.get_value("User", user_id, ["full_name", "user_image"], as_dict=True)

	if not user_info:
		return None

	return {
		"full_name": user_info.get("full_name") or user_id,
		"user_image": user_info.get("user_image"),
		"is_guest": False,
	}


def get_guest_session(guest_id: str) -> dict | None:
	"""Retrieve guest session data from cache."""
	cache_key = f"guest_session:{guest_id}"
	session_data = frappe.cache.get_value(cache_key)

	if not session_data:
		return None

	if isinstance(session_data, dict):
		return session_data

	return None


def set_guest_session(guest_id: str, session_data: dict, ttl: int = 86400) -> None:
	"""Store guest session data (default 24 hours)."""
	cache_key = f"guest_session:{guest_id}"
	frappe.cache.set_value(cache_key, session_data, expires_in_sec=ttl)


def generate_guest_secret() -> str:
	"""Generate a cryptographically random secret for guest session proof-of-possession."""
	return secrets.token_urlsafe(32)


def verify_guest_secret(guest_id: str, guest_secret: str | None) -> bool:
	"""
	Verify that the provided guest_secret matches the one stored in the guest session.

	Returns False if:
	  - guest_secret is missing or empty
	  - no session exists for guest_id
	  - the session has no stored secret (migrated / legacy)
	  - the secret does not match (constant-time compare)
	"""
	if not guest_secret:
		return False

	session_data = get_guest_session(guest_id)
	if not session_data:
		return False

	stored_secret = session_data.get("guest_secret")
	if not stored_secret:
		return False

	return secrets.compare_digest(guest_secret, stored_secret)


def validate_guest_name(guest_name: str) -> tuple[bool, str | None]:
	"""
	Validate guest name.

	Returns (is_valid, error_message).
	"""
	if not guest_name or not guest_name.strip():
		return False, "Guest name is required"

	guest_name = guest_name.strip()

	if len(guest_name) < 2:
		return False, "Guest name must be at least 2 characters"

	if len(guest_name) > 50:
		return False, "Guest name must be at most 50 characters"

	if not re.match(r"^[a-zA-Z0-9\s'\-]+$", guest_name):
		return False, "Guest name contains invalid characters"

	return True, None
