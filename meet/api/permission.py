import frappe


def has_app_permission() -> bool:
	if frappe.session.user == "Administrator":
		return True

	roles = frappe.get_roles()
	meet_roles = ["Meet User"]
	if any(role in roles for role in meet_roles):
		return True

	return False
