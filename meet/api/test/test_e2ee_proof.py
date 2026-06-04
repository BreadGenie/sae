# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import base64
import json

import frappe
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from frappe.tests import IntegrationTestCase

from meet.api.meeting import (
	_is_valid_e2ee_device_id,
	_is_valid_e2ee_host_public_key,
	_is_valid_e2ee_proof,
	_is_valid_e2ee_version,
	_verify_e2ee_proof_signature,
	convert_meeting_to_e2ee,
)
from meet.meet.doctype.sae_meeting.sae_meeting import SaeMeeting


def _b64(raw: bytes) -> str:
	return base64.b64encode(raw).decode("ascii")


class IntegrationTestE2EEProof(IntegrationTestCase):
	"""Validation tests for the v2 E2EE proof + host pubkey flow.

	Generates an ed25519 auth keypair + an X25519 public key (32 random bytes
	acting as a stand-in) to exercise the server-side signature verification
	without depending on WebCrypto.
	"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.host_email = "host-e2ee@example.com"
		cls._ensure_user(cls.host_email, "HostE2EE")

	@classmethod
	def _ensure_user(cls, email: str, first_name: str):
		if frappe.db.exists("User", email):
			user = frappe.get_doc("User", email)
		else:
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": first_name,
					"enabled": 1,
					"new_password": "password",
				}
			)
			user.insert(ignore_permissions=True)
		if not any(r.role == "Meet User" for r in user.roles):
			user.append("roles", {"role": "Meet User"})
			user.save(ignore_permissions=True)

	def _set_device_keys(self, email: str, device_id: str, ed25519_pub_b64: str):
		user = frappe.get_doc("User", email)
		device_keys = {}
		if user.device_keys:
			try:
				device_keys = (
					json.loads(user.device_keys) if isinstance(user.device_keys, str) else user.device_keys
				)
			except (TypeError, ValueError):
				device_keys = {}
		if not isinstance(device_keys, dict):
			device_keys = {}
		device_keys[device_id] = {"ed25519_pub": ed25519_pub_b64}
		user.db_set("device_keys", json.dumps(device_keys), update_modified=False)

	def test_validators(self):
		self.assertTrue(_is_valid_e2ee_version("v1-abcd1234"))
		self.assertTrue(_is_valid_e2ee_version("v12-deadbeef"))
		self.assertFalse(_is_valid_e2ee_version("v0-abcd1234"))
		self.assertFalse(_is_valid_e2ee_version("v-1234"))
		self.assertFalse(_is_valid_e2ee_version("garbage"))

		good_sig = _b64(b"\x00" * 64)
		bad_sig = _b64(b"\x00" * 63)
		non_b64 = "not_base64@@@"
		self.assertTrue(_is_valid_e2ee_proof(good_sig))
		self.assertFalse(_is_valid_e2ee_proof(bad_sig))
		self.assertFalse(_is_valid_e2ee_proof(non_b64))
		self.assertFalse(_is_valid_e2ee_proof(None))
		self.assertFalse(_is_valid_e2ee_proof(""))

		good_pk = _b64(b"\x11" * 32)
		bad_pk = _b64(b"\x11" * 31)
		self.assertTrue(_is_valid_e2ee_host_public_key(good_pk))
		self.assertFalse(_is_valid_e2ee_host_public_key(bad_pk))
		self.assertFalse(_is_valid_e2ee_host_public_key(None))

		self.assertTrue(_is_valid_e2ee_device_id("default"))
		self.assertTrue(_is_valid_e2ee_device_id("laptop-2026-01"))
		self.assertFalse(_is_valid_e2ee_device_id(""))
		self.assertFalse(_is_valid_e2ee_device_id("a" * 65))
		self.assertFalse(_is_valid_e2ee_device_id("has space"))

	def test_signature_roundtrip(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub = auth_priv.public_key()
		auth_pub_b64 = _b64(auth_pub.public_bytes_raw())
		host_x25519_pub = b"\x22" * 32
		host_x25519_pub_b64 = _b64(host_x25519_pub)
		version = "v1-12345678"
		device_id = "test-device-1"

		message = host_x25519_pub + version.encode("utf-8")
		sig = auth_priv.sign(message)
		sig_b64 = _b64(sig)

		self._set_device_keys(self.host_email, device_id, auth_pub_b64)

		self.assertTrue(
			_verify_e2ee_proof_signature(
				sig_b64,
				host_x25519_pub_b64,
				version,
				device_id,
				self.host_email,
			)
		)

		# Tampered signature
		bad_sig = bytearray(sig)
		bad_sig[0] ^= 0xFF
		self.assertFalse(
			_verify_e2ee_proof_signature(
				_b64(bytes(bad_sig)),
				host_x25519_pub_b64,
				version,
				device_id,
				self.host_email,
			)
		)

		# Tampered message (wrong version)
		self.assertFalse(
			_verify_e2ee_proof_signature(
				sig_b64,
				host_x25519_pub_b64,
				"v1-deadbeef",
				device_id,
				self.host_email,
			)
		)

		# Unknown device
		self.assertFalse(
			_verify_e2ee_proof_signature(
				sig_b64,
				host_x25519_pub_b64,
				version,
				"unknown-device",
				self.host_email,
			)
		)

	def test_convert_meeting_to_e2ee_rejects_bad_proof(self):
		frappe.set_user(self.host_email)
		meeting = frappe.get_doc(
			{
				"doctype": "Sae Meeting",
				"meeting_type": "open",
				"allow_guest": 1,
			}
		)
		meeting.insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Sae Meeting", meeting.name, ignore_permissions=True))

		with self.assertRaises(frappe.ValidationError):
			convert_meeting_to_e2ee(
				meeting_id=meeting.name,
				e2ee_key_proof="not-a-valid-base64-sig",
				e2ee_key_version="v1-12345678",
				e2ee_host_public_key=_b64(b"\x33" * 32),
				e2ee_device_id="laptop",
			)

	def test_convert_meeting_to_e2ee_succeeds_with_valid_proof(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub_b64 = _b64(auth_priv.public_key().public_bytes_raw())
		host_pub = b"\x44" * 32
		host_pub_b64 = _b64(host_pub)
		version = "v1-abcdef01"
		device_id = "laptop-2026"
		message = host_pub + version.encode("utf-8")
		sig_b64 = _b64(auth_priv.sign(message))

		self._set_device_keys(self.host_email, device_id, auth_pub_b64)

		frappe.set_user(self.host_email)
		meeting = frappe.get_doc(
			{
				"doctype": "Sae Meeting",
				"meeting_type": "open",
				"allow_guest": 1,
			}
		)
		meeting.insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Sae Meeting", meeting.name, ignore_permissions=True))

		result = convert_meeting_to_e2ee(
			meeting_id=meeting.name,
			e2ee_key_proof=sig_b64,
			e2ee_key_version=version,
			e2ee_host_public_key=host_pub_b64,
			e2ee_device_id=device_id,
		)

		self.assertTrue(result["e2ee_enabled"])
		self.assertEqual(result["e2ee_key_version"], version)
		self.assertEqual(result["e2ee_host_public_key"], host_pub_b64)

		meeting.reload()
		self.assertTrue(meeting.e2ee_enabled)
		self.assertEqual(meeting.e2ee_key_version, version)
		self.assertEqual(meeting.e2ee_host_public_key, host_pub_b64)
		self.assertEqual(meeting.e2ee_key_proof, sig_b64)
