# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json
import random
import string

import frappe
from frappe.model.document import Document


class SaeMeeting(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from sae.sae.doctype.sae_meeting_user.sae_meeting_user import SaeMeetingUser

		banned_users: DF.TableMultiSelect[SaeMeetingUser]
		is_active: DF.Check
		meeting_type: DF.Literal["open", "restricted"]
		members: DF.TableMultiSelect[SaeMeetingUser]
		started_at: DF.Datetime | None
		waiting_room: DF.TableMultiSelect[SaeMeetingUser]
	# end: auto-generated types

	def autoname(self):
		"""Set the name of the meeting"""
		if not self.name:
			self.name = generate()

	def before_insert(self):
		"""Initialize meeting room"""
		if not hasattr(self, "is_active"):
			self.is_active = 1

	def after_insert(self):
		self.join(frappe.session.user)

	def join(self, user=None):
		"""
		Join the meeting room

		Args:
			user: User to join (defaults to current session user)
		"""
		if not user:
			user = frappe.session.user

		if self.meeting_type == "restricted" and user != self.owner:
			if not self.is_user_approved(user):
				self.add_to_waiting_room(user)
				return {"status": "waiting_for_approval", "message": "Waiting for host approval"}

		# Get current members list
		members = self.get_members()

		# Add user if not already in room
		if user not in members:
			members.append(user)
			self.update_members(members)
			self.remove_from_waiting_room(user)

		# Send join confirmation to the user
		frappe.publish_realtime(
			"meeting_joined",
			{"meeting": self.name, "user": user, "members": members, "member_count": len(members)},
			user=user,
		)

		return {"status": "joined", "message": "Successfully joined the meeting"}

	def leave(self, user=None):
		"""
		Leave the meeting room

		Args:
			user: User to remove (defaults to current session user)
		"""
		if not user:
			user = frappe.session.user

		members = self.get_members()

		if user in members:
			members.remove(user)
			self.update_members(members)

			if not members:
				self.is_active = 0
				self.save(ignore_permissions=True)

	def get_members(self):
		"""Get list of current members"""
		return [row.user for row in self.members] if self.members else []

	def can_join(self, user=None):
		"""
		Check if a user can join this meeting

		Args:
			user: User to check (defaults to current session user)

		Returns:
			bool: True if user can join, False otherwise
		"""
		if not user:
			user = frappe.session.user

		if self.is_user_banned(user):
			return False

		# Check if meeting is active
		# if not self.get("is_active", True):
		# 	return False

		# Check if user has read permission on the meeting
		# if not frappe.has_permission("Sae Meeting", "read", self):
		# 	return False

		return True

	def update_members(self, members_list):
		"""Update members list and save"""
		self.members = []

		for user in members_list:
			self.append("members", {"user": user})

		self.save(ignore_permissions=True)

	def get_waiting_room(self):
		"""Get list of users waiting for approval"""
		return [row.user for row in self.waiting_room] if self.waiting_room else []

	def add_to_waiting_room(self, user):
		"""Add user to waiting room"""
		if self.is_user_approved(user):
			return

		waiting_users = self.get_waiting_room()
		if user not in waiting_users:
			self.append("waiting_room", {"user": user})
			self.save(ignore_permissions=True)

		user_doc = frappe.db.get_value("User", user, ["full_name", "user_image"], as_dict=True)
		frappe.publish_realtime(
			"meeting_join_request",
			user=self.owner,
			message={
				"meeting": self.name,
				"user": user,
				"user_name": user_doc.full_name,
				"user_image": user_doc.user_image,
				"waiting_count": len(waiting_users) + 1,
			},
		)

	def remove_from_waiting_room(self, user):
		"""Remove user from waiting room"""
		self.waiting_room = [row for row in self.waiting_room if row.user != user]
		self.save(ignore_permissions=True)

	def approve_user(self, user):
		"""Approve a user from waiting room to join the meeting"""
		if frappe.session.user != self.owner:
			frappe.throw("Only the meeting creator can approve join requests")

		waiting_users = self.get_waiting_room()
		if user not in waiting_users:
			frappe.throw("User is not in waiting room")

		members = self.get_members()

		if user not in members:
			members.append(user)
			self.update_members(members)

		self.remove_from_waiting_room(user)

		frappe.publish_realtime(
			"meeting_join_approved",
			user=user,
			message={"meeting": self.name, "user": user, "approved_by": frappe.session.user},
		)

		updated_waiting_users = self.get_waiting_room()
		frappe.publish_realtime(
			"meeting_waiting_room_updated",
			doctype=self.doctype,
			docname=self.name,
			message={"meeting": self.name, "waiting_count": len(updated_waiting_users)},
		)

		return {"status": "joined", "message": "Successfully joined the meeting"}

	def reject_user(self, user, rejected_by=None):
		"""Reject a user from waiting room"""
		if not rejected_by:
			rejected_by = frappe.session.user

		if rejected_by != self.owner:
			frappe.throw("Only the meeting creator can reject join requests")

		waiting_users = self.get_waiting_room()
		if user not in waiting_users:
			frappe.throw("User is not in waiting room")

		self.remove_from_waiting_room(user)

		frappe.publish_realtime(
			"meeting_join_rejected",
			user=user,
			message={"meeting": self.name, "user": user, "rejected_by": rejected_by},
		)

		updated_waiting_users = self.get_waiting_room()
		frappe.publish_realtime(
			"meeting_waiting_room_updated",
			doctype=self.doctype,
			docname=self.name,
			message={"meeting": self.name, "waiting_count": len(updated_waiting_users)},
		)

	def is_user_approved(self, user):
		"""Check if user is already approved"""

		if user == self.owner:
			return True

		members = self.get_members()
		return user in members

	def is_user_banned(self, user):
		"""Check if user is banned from this meeting"""
		if not self.get("banned_users"):
			return False

		banned_user_emails = [row.user for row in self.banned_users]
		return user in banned_user_emails


def generate(segment_length=4, num_segments=3, separator="-"):
	# Define the character set: only lowercase letters
	characters = string.ascii_lowercase

	# Generate segments
	segments = []
	for _ in range(num_segments):
		segment = "".join(random.choice(characters) for _ in range(segment_length))
		segments.append(segment)

	# Join segments with the separator
	random_id = separator.join(segments)
	return random_id
