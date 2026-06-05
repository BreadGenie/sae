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
	register_e2ee_device,
)


def _b64(raw: bytes) -> str:
	return base64.b64encode(raw).decode("ascii")


class IntegrationTestE2EEProof(IntegrationTestCase):
	"""Validation tests for the E2EE proof + host pubkey flow.

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
		existing_name = frappe.db.get_value(
			"E2EE Device Key", {"user": email, "device_id": device_id}, "name"
		)
		if existing_name:
			frappe.db.set_value(
				"E2EE Device Key",
				existing_name,
				"ed25519_public_key",
				ed25519_pub_b64,
				update_modified=False,
			)
		else:
			doc = frappe.new_doc("E2EE Device Key")
			doc.user = email
			doc.device_id = device_id
			doc.ed25519_public_key = ed25519_pub_b64
			doc.insert(ignore_permissions=True)

	def test_validators(self):
		self.assertTrue(_is_valid_e2ee_version("abcd1234"))
		self.assertTrue(_is_valid_e2ee_version("deadbeef"))
		self.assertFalse(_is_valid_e2ee_version("abc"))  # too short
		self.assertFalse(_is_valid_e2ee_version("abcdefgh"))  # non-hex
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
		version = "12345678"
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
				"deadbeef",
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
				e2ee_key_version="12345678",
				e2ee_host_public_key=_b64(b"\x33" * 32),
				e2ee_host_signing_public_key=_b64(b"\x44" * 32),
				e2ee_device_id="laptop",
			)

	def test_convert_meeting_to_e2ee_succeeds_with_valid_proof(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub_b64 = _b64(auth_priv.public_key().public_bytes_raw())
		host_pub = b"\x44" * 32
		host_pub_b64 = _b64(host_pub)
		host_signing_pub = b"\x55" * 32
		host_signing_pub_b64 = _b64(host_signing_pub)
		version = "abcdef01"
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
			e2ee_host_signing_public_key=host_signing_pub_b64,
			e2ee_device_id=device_id,
		)

		self.assertTrue(result["e2ee_enabled"])
		self.assertEqual(result["e2ee_key_version"], version)
		self.assertEqual(result["e2ee_host_public_key"], host_pub_b64)

		meeting.reload()
		self.assertTrue(meeting.e2ee_enabled)
		self.assertEqual(meeting.e2ee_key_version, version)
		self.assertEqual(meeting.e2ee_host_public_key, host_pub_b64)
		self.assertEqual(meeting.e2ee_host_signing_public_key, host_signing_pub_b64)
		self.assertEqual(meeting.e2ee_key_proof, sig_b64)

	def test_convert_meeting_to_e2ee_rotates_existing_epoch(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub_b64 = _b64(auth_priv.public_key().public_bytes_raw())
		device_id = "laptop-2026-rotate"
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

		first_host_pub = b"\x44" * 32
		first_version = "abcdef01"
		first_sig = _b64(auth_priv.sign(first_host_pub + first_version.encode("utf-8")))
		convert_meeting_to_e2ee(
			meeting_id=meeting.name,
			e2ee_key_proof=first_sig,
			e2ee_key_version=first_version,
			e2ee_host_public_key=_b64(first_host_pub),
			e2ee_host_signing_public_key=_b64(b"\x55" * 32),
			e2ee_device_id=device_id,
		)

		second_host_pub = b"\x66" * 32
		second_signing_pub_b64 = _b64(b"\x77" * 32)
		second_version = "fedcba09"
		second_sig = _b64(auth_priv.sign(second_host_pub + second_version.encode("utf-8")))
		result = convert_meeting_to_e2ee(
			meeting_id=meeting.name,
			e2ee_key_proof=second_sig,
			e2ee_key_version=second_version,
			e2ee_host_public_key=_b64(second_host_pub),
			e2ee_host_signing_public_key=second_signing_pub_b64,
			e2ee_device_id=device_id,
		)

		self.assertTrue(result["e2ee_enabled"])
		self.assertEqual(result["e2ee_key_version"], second_version)
		self.assertEqual(result["e2ee_host_public_key"], _b64(second_host_pub))

		meeting.reload()
		self.assertEqual(meeting.e2ee_key_version, second_version)
		self.assertEqual(meeting.e2ee_host_public_key, _b64(second_host_pub))
		self.assertEqual(meeting.e2ee_host_signing_public_key, second_signing_pub_b64)
		self.assertEqual(meeting.e2ee_key_proof, second_sig)

	def test_convert_meeting_to_e2ee_rejects_missing_signing_pubkey(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub_b64 = _b64(auth_priv.public_key().public_bytes_raw())
		host_pub = b"\x66" * 32
		host_pub_b64 = _b64(host_pub)
		version = "abcdef02"
		device_id = "laptop-2026-no-sig"
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

		with self.assertRaises(frappe.ValidationError):
			convert_meeting_to_e2ee(
				meeting_id=meeting.name,
				e2ee_key_proof=sig_b64,
				e2ee_key_version=version,
				e2ee_host_public_key=host_pub_b64,
				e2ee_device_id=device_id,
			)

	def test_register_e2ee_device_persists_pubkey(self):
		auth_priv = Ed25519PrivateKey.generate()
		auth_pub_b64 = _b64(auth_priv.public_key().public_bytes_raw())
		device_id = "laptop-2026-register"

		frappe.set_user(self.host_email)
		# Clear any pre-existing entry for this device.
		existing_name = frappe.db.get_value(
			"E2EE Device Key", {"user": self.host_email, "device_id": device_id}, "name"
		)
		if existing_name:
			frappe.delete_doc("E2EE Device Key", existing_name, ignore_permissions=True)

		result = register_e2ee_device(
			device_id=device_id,
			ed25519_public_key=auth_pub_b64,
		)
		self.assertEqual(result["device_id"], device_id)
		self.assertEqual(result["ed25519_public_key"], auth_pub_b64)

		stored = frappe.db.get_value(
			"E2EE Device Key",
			{"user": self.host_email, "device_id": device_id},
			"ed25519_public_key",
		)
		self.assertEqual(stored, auth_pub_b64)

		# Re-registering overwrites with the new key.
		new_auth = Ed25519PrivateKey.generate()
		new_pub_b64 = _b64(new_auth.public_key().public_bytes_raw())
		register_e2ee_device(
			device_id=device_id,
			ed25519_public_key=new_pub_b64,
		)
		stored = frappe.db.get_value(
			"E2EE Device Key",
			{"user": self.host_email, "device_id": device_id},
			"ed25519_public_key",
		)
		self.assertEqual(stored, new_pub_b64)

	def test_register_e2ee_device_rejects_invalid_inputs(self):
		frappe.set_user(self.host_email)
		with self.assertRaises(frappe.ValidationError):
			register_e2ee_device(device_id="bad device id", ed25519_public_key=_b64(b"\x00" * 32))
		with self.assertRaises(frappe.ValidationError):
			register_e2ee_device(device_id="good-id", ed25519_public_key="not_base64@@@")
		with self.assertRaises(frappe.ValidationError):
			register_e2ee_device(device_id="good-id", ed25519_public_key=_b64(b"\x00" * 31))
