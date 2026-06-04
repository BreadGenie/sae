# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe

MEET_USER_ROLE = "Meet User"


def after_app_install(app_name: str | None = None):
	assign_meet_role_to_all_users()
	ensure_e2ee_custom_field()


def assign_meet_role_to_all_users():
	if not frappe.db.exists("Role", MEET_USER_ROLE):
		return

	users = frappe.get_all(
		"User",
		filters={"enabled": 1, "name": ["not in", ["Guest", "Administrator"]]},
		pluck="name",
	)

	for user_name in users:
		user = frappe.get_doc("User", user_name)
		if not any(r.role == MEET_USER_ROLE for r in user.roles):
			user.append("roles", {"role": MEET_USER_ROLE})
			user.save(ignore_permissions=True)


def ensure_e2ee_custom_field():
	"""Install the `device_keys` Custom Field on User for E2EE v2.

	`device_keys` is a JSON field that maps a per-device id (chosen client-side)
	to the device's ed25519 public key (base64). Used by the server to verify
	ed25519 signatures from the host's device when enabling E2EE.
	"""
	if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "device_keys"}):
		return

	frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": "User",
			"fieldname": "device_keys",
			"label": "E2EE Device Keys (JSON)",
			"fieldtype": "JSON",
			"hidden": 1,
			"read_only": 1,
			"description": (
				"Per-device ed25519 public keys for E2EE v2 host identity. "
				'Shape: {"<device_id>": {"ed25519_pub": "<base64>"}}'
			),
		}
	).insert(ignore_permissions=True)
