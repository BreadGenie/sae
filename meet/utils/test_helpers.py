# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""
Helper functions for testing
"""

import frappe


def create_test_users():
	"""
	Create test users for E2E testing.
	This function should be called during CI setup or manually for local testing.

	Creates 4 test users
	"""
	test_users = [
		{
			"email": "test-user-1@example.com",
			"first_name": "Test User One",
		},
		{
			"email": "test-user-2@example.com",
			"first_name": "Test User Two",
		},
		{
			"email": "test-user-3@example.com",
			"first_name": "Test User Three",
		},
		{
			"email": "test-user-4@example.com",
			"first_name": "Test User Four",
		},
	]

	password = "test-password-123"

	for user_data in test_users:
		email = user_data["email"]

		if frappe.db.exists("User", email):
			print(f"Test user {email} already exists, skipping...")
			continue

		user = frappe.new_doc("User")
		user.email = email
		user.first_name = user_data["first_name"]
		user.new_password = password
		user.send_welcome_email = 0
		user.user_type = "System User"

		user.add_roles("Meet User")
		print(f"Created test user: {email}")

	print("Test users created successfully!")
