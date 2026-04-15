# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import whitelist_for_tests


@whitelist_for_tests()
def clear_create_rate_limit() -> None:
	"""Clear meeting creation, join meeting as guest rate limit cache."""
	keys = frappe.cache.get_keys("rl:meet.api.meeting.join_meeting_as_guest:*")
	keys += frappe.cache.get_keys("rl:meet.api.meeting.create:*")
	for key in keys:
		frappe.cache.set(key, 0)  # nosemgrep
