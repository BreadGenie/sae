# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe

MEET_USER_ROLE = "Meet User"


def after_app_install(app_name: str | None = None):
	assign_meet_role_to_all_users()


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
