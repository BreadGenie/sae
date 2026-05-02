# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import re
import unicodedata

import frappe
from frappe import _

CUSTOM_ROOM_MIN_LENGTH = 3
CUSTOM_ROOM_MAX_LENGTH = 64


def canonicalize_custom_room_name(room_name: str) -> str:
	if not isinstance(room_name, str):
		return ""

	# normalize to ascii
	ascii_name = unicodedata.normalize("NFKD", room_name).encode("ascii", "ignore").decode("ascii")
	ascii_name = ascii_name.strip().lower()
	ascii_name = re.sub(r"[\s_]+", "-", ascii_name)
	ascii_name = re.sub(r"[^a-z0-9-]", "", ascii_name)
	return ascii_name.strip("-")


def validate_custom_room_name(room_name: str) -> str:
	slug = canonicalize_custom_room_name(room_name)

	if not slug:
		frappe.throw(_("Please enter a valid room name"), frappe.ValidationError)

	if len(slug) < CUSTOM_ROOM_MIN_LENGTH:
		frappe.throw(
			_(f"Room name must be longer than {CUSTOM_ROOM_MIN_LENGTH} characters"),
			frappe.ValidationError,
		)

	if len(slug) > CUSTOM_ROOM_MAX_LENGTH:
		frappe.throw(
			_(f"Room name must be shorter than {CUSTOM_ROOM_MAX_LENGTH} characters"),
			frappe.ValidationError,
		)

	if re.search(r"-{3,}", slug):
		frappe.throw(_("Please enter a simpler room name"), frappe.ValidationError)

	return slug
