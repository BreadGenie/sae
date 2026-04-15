# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import whitelist_for_tests


@whitelist_for_tests()
def clear_create_rate_limit() -> None:
	"""Clear meeting creation rate limit cache. Only available in test/CI environments."""
	frappe.cache.delete_keys("rl:meet.api.meeting.create:*")
