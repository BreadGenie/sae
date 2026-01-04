# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import json
import logging
import threading
from collections.abc import Callable

import frappe
import socketio

logger = logging.getLogger(__name__)


class SFUConnectionManager:
	"""Manages the socket.io connection between Frappe server and SFU (mediasoup server)"""

	def __init__(self):
		self.sio: socketio.Client | None = None
		self.connected: bool = False
		self.meeting_rooms: dict[str, dict] = {}
		self.event_handlers: dict[str, Callable] = {}
		self._setup_event_handlers()

	def _setup_event_handlers(self):
		"""Setup default event handlers for SFU communication"""
		self.event_handlers = {
			"connect": self._on_connect,
			"disconnect": self._on_disconnect,
			"room_created": self._on_room_created,
			"participant_joined": self._on_participant_joined,
			"participant_left": self._on_participant_left,
			"webrtc_offer": self._on_webrtc_offer,
			"webrtc_answer": self._on_webrtc_answer,
			"ice_candidate": self._on_ice_candidate,
			"producer_created": self._on_producer_created,
			"producer_closed": self._on_producer_closed,
			"consumer_created": self._on_consumer_created,
			"consumer_closed": self._on_consumer_closed,
			"error": self._on_error,
			# mediasoup-specific events
			"router_capabilities": self._on_router_capabilities,
			"transport_created": self._on_transport_created,
			"transport_connected": self._on_transport_connected,
			"media_produced": self._on_media_produced,
			"media_consumed": self._on_media_consumed,
			"producer_paused": self._on_producer_paused,
			"producer_resumed": self._on_producer_resumed,
			"consumer_paused": self._on_consumer_paused,
			"consumer_resumed": self._on_consumer_resumed,
		}

	def connect(self):
		"""Simple connect method for compatibility"""
		if not self.connected:
			self.connect_to_sfu()
		return self.connected

	def connect_to_sfu(self, sfu_url: str | None = None, sfu_port: int | None = None):
		"""Connect to the SFU server"""
		try:
			if not sfu_url:
				sfu_url = frappe.conf.get("sfu_server_url", "http://localhost")
			if not sfu_port:
				sfu_port = frappe.conf.get("sfu_server_port", 3000)

			sfu_endpoint = f"{sfu_url}:{sfu_port}"
			logger.info(f"Attempting to connect to SFU at {sfu_endpoint}")

			self.sio = socketio.Client(
				reconnection=True,
				reconnection_attempts=5,
				reconnection_delay=1,
				reconnection_delay_max=5,
				logger=True,
				engineio_logger=True,
			)

			# Register event handlers
			for event, handler in self.event_handlers.items():
				self.sio.on(event, handler)

			# Connect to SFU
			logger.info("Connecting to SFU...")
			self.sio.connect(sfu_endpoint)
			logger.info(f"Connected to SFU at {sfu_endpoint}")

		except Exception as e:
			logger.error(f"Failed to connect to SFU: {e!s}")
			raise

	def disconnect_from_sfu(self):
		"""Disconnect from the SFU server"""
		if self.sio and self.connected:
			self.sio.disconnect()
			self.connected = False
			logger.info("Disconnected from SFU")

	def create_room(self, room_id: str, options: dict | None = None) -> bool:
		"""Create a new room on the SFU"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			data = {"roomId": room_id, "options": options or {}}
			self.sio.emit("createRoom", data)
			logger.info(f"Created room {room_id} on SFU")
			return True
		except Exception as e:
			logger.error(f"Failed to create room {room_id}: {e!s}")
			return False

	def join_room(self, room_id: str, participant_id: str, user_data: dict | None = None) -> bool:
		"""Join a participant to a room on the SFU"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			data = {"roomId": room_id, "participantId": participant_id, "userData": user_data or {}}
			self.sio.emit("joinRoom", data)
			logger.info(f"Participant {participant_id} joined room {room_id}")
			return True
		except Exception as e:
			logger.error(f"Failed to join room {room_id}: {e!s}")
			return False

	def leave_room(self, room_id: str, participant_id: str) -> bool:
		"""Remove a participant from a room on the SFU"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			data = {"roomId": room_id, "participantId": participant_id}
			self.sio.emit("leaveRoom", data)
			logger.info(f"Participant {participant_id} left room {room_id}")
			return True
		except Exception as e:
			logger.error(f"Failed to leave room {room_id}: {e!s}")
			return False

	def relay_to_sfu(self, event: str, data: dict, room_id: str | None = None):
		"""Relay an event from client to SFU"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			payload = data.copy()
			if room_id:
				payload["roomId"] = room_id

			self.sio.emit(event, payload)
			logger.debug(f"Relayed event {event} to SFU")
		except Exception as e:
			logger.error(f"Failed to relay event {event} to SFU: {e!s}")

	def get_router_rtp_capabilities(self, room_id: str) -> dict:
		"""Get router RTP capabilities from SFU using call() method"""
		if not self.connected:
			logger.info("Not connected to SFU, attempting to connect...")
			raise Exception("Not connected to SFU")

		try:
			logger.info(f"Requesting router capabilities for room: {room_id}")
			logger.info(f"SFU connection status: connected={self.connected}, socket={self.sio}")

			# Use call() method for request-response pattern - this is the correct way
			logger.info("About to call sio.call() with get_router_rtp_capabilities...")
			response = self.sio.call("get_router_rtp_capabilities", {"roomId": room_id}, timeout=10)

			logger.info(f"Received response from SFU: {response}")
			logger.info(f"Response type: {type(response)}")

			if not response:
				logger.error("No response from SFU - response is None or empty")
				raise Exception("No response from SFU")

			if response.get("success"):
				capabilities = response.get("rtpCapabilities")
				logger.info(
					f"Successfully got router capabilities: {len(str(capabilities)) if capabilities else 0} chars"
				)
				return capabilities
			else:
				error = response.get("error", "Unknown error")
				logger.error(f"SFU returned error: {error}")
				raise Exception(f"SFU error: {error}")

		except Exception as e:
			logger.error(f"Failed to get router capabilities: {e!s}")
			import traceback

			logger.error(f"Full traceback: {traceback.format_exc()}")
			raise

	def create_webrtc_transport(self, room_id: str, user_id: str, direction: str = "send"):
		"""Create a WebRTC transport through the SFU"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			logger.info(
				f"Creating WebRTC transport for room: {room_id}, user: {user_id}, direction: {direction}"
			)

			# Use call() method for request-response pattern
			response = self.sio.call(
				"create_webrtc_transport",
				{"roomId": room_id, "userId": user_id, "direction": direction},
				timeout=10,
			)

			logger.info(f"Received transport response from SFU: {response}")

			if not response:
				logger.error("No response from SFU - response is None or empty")
				raise Exception("No response from SFU")

			if response.get("success"):
				# Extract transport parameters from response
				transport_options = {
					"id": response.get("id"),
					"iceParameters": response.get("iceParameters"),
					"iceCandidates": response.get("iceCandidates"),
					"dtlsParameters": response.get("dtlsParameters"),
					"sctpParameters": response.get("sctpParameters"),
				}
				logger.info(f"Successfully created transport: {transport_options['id']}")
				return transport_options
			else:
				error = response.get("error", "Unknown error")
				logger.error(f"SFU returned error: {error}")
				raise Exception(f"SFU error: {error}")

		except Exception as e:
			logger.error(f"Failed to create WebRTC transport: {e!s}")
			import traceback

			logger.error(f"Full traceback: {traceback.format_exc()}")
			raise

	def get_existing_producers(self, room_id: str, user_id: str):
		"""Get existing producers in a room for new participants"""
		if not self.connected:
			raise Exception("Not connected to SFU")

		try:
			logger.info(f"Getting existing producers for room: {room_id}, user: {user_id}")

			# Use call() method for request-response pattern
			response = self.sio.call("get_existing_producers", {"roomId": room_id, "userId": user_id})

			logger.info(f"Received existing producers response from SFU: {response}")

			if not response:
				logger.error("No response from SFU - response is None or empty")
				return []

			if response.get("success"):
				producers = response.get("producers", [])
				logger.info(f"Successfully got {len(producers)} existing producers")
				return producers
			else:
				error = response.get("error", "Unknown error")
				logger.error(f"SFU returned error: {error}")
				return []

		except Exception as e:
			logger.error(f"Failed to get existing producers: {e!s}")
			import traceback

			logger.error(f"Full traceback: {traceback.format_exc()}")
			return []

	def relay_to_client(
		self, event: str, data: dict, target_user: str | None = None, room_id: str | None = None
	):
		"""Relay an event from SFU to client(s)"""
		try:
			# Use Frappe's real-time functionality to send to clients
			if target_user:
				frappe.publish_realtime(event, message=data, user=target_user, after_commit=True)
			elif room_id:
				# Get all participants in the room and send to each
				meeting_doc = frappe.get_doc("Sae Meeting", room_id)
				members = meeting_doc.get_members()
				for member in members:
					frappe.publish_realtime(event, message=data, user=member, after_commit=True)
			else:
				# Broadcast to all connected users
				frappe.publish_realtime(event, message=data, after_commit=True)

			logger.debug(f"Relayed event {event} to client(s)")
		except Exception as e:
			logger.error(f"Failed to relay event {event} to client: {e!s}")

	# Event handlers for SFU events
	def _on_connect(self):
		"""Handle SFU connection"""
		self.connected = True
		logger.info("Connected to SFU server")

	def _on_disconnect(self):
		"""Handle SFU disconnection"""
		self.connected = False
		logger.info("Disconnected from SFU server")

	def _on_room_created(self, data):
		"""Handle room creation confirmation from SFU"""
		room_id = data.get("roomId")
		self.meeting_rooms[room_id] = data
		logger.info(f"Room {room_id} created on SFU")

		# Notify clients
		self.relay_to_client("room_created", data, room_id=room_id)

	def _on_participant_joined(self, data):
		"""Handle participant join confirmation from SFU"""
		room_id = data.get("roomId")
		participant_id = data.get("participantId")
		logger.info(f"Participant {participant_id} joined room {room_id} on SFU")

		# Notify other participants
		self.relay_to_client("participant_joined", data, room_id=room_id)

	def _on_participant_left(self, data):
		"""Handle participant leave confirmation from SFU"""
		room_id = data.get("roomId")
		participant_id = data.get("participantId")
		logger.info(f"Participant {participant_id} left room {room_id} on SFU")

		# Notify other participants
		self.relay_to_client("participant_left", data, room_id=room_id)

	def _on_webrtc_offer(self, data):
		"""Handle WebRTC offer from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("webrtc_offer", data, target_user=target_user)

	def _on_webrtc_answer(self, data):
		"""Handle WebRTC answer from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("webrtc_answer", data, target_user=target_user)

	def _on_ice_candidate(self, data):
		"""Handle ICE candidate from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("ice_candidate", data, target_user=target_user)

	def _on_producer_created(self, data):
		"""Handle producer creation from SFU"""
		room_id = data.get("roomId")
		target_user = data.get("targetUser")

		if target_user:
			self.relay_to_client("producer_created", data, target_user=target_user)
		else:
			self.relay_to_client("producer_created", data, room_id=room_id)

	def _on_producer_closed(self, data):
		"""Handle producer closure from SFU"""
		room_id = data.get("roomId")
		target_user = data.get("targetUser")

		if target_user:
			self.relay_to_client("producer_closed", data, target_user=target_user)
		else:
			self.relay_to_client("producer_closed", data, room_id=room_id)

	def _on_consumer_created(self, data):
		"""Handle consumer creation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("consumer_created", data, target_user=target_user)

	def _on_consumer_closed(self, data):
		"""Handle consumer closure from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("consumer_closed", data, target_user=target_user)

	def _on_error(self, data):
		"""Handle errors from SFU"""
		logger.error(f"SFU error: {data}")
		# Relay error to relevant clients
		room_id = data.get("roomId")
		target_user = data.get("targetUser")

		if target_user:
			self.relay_to_client("sfu_error", data, target_user=target_user)
		elif room_id:
			self.relay_to_client("sfu_error", data, room_id=room_id)

	# New event handlers for mediasoup-specific events
	def _on_router_capabilities(self, data):
		"""Handle router RTP capabilities from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("router_rtp_capabilities", data, target_user=target_user)

	def _on_transport_created(self, data):
		"""Handle transport creation confirmation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("webrtc_transport_created", data, target_user=target_user)

	def _on_transport_connected(self, data):
		"""Handle transport connection confirmation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("webrtc_transport_connected", data, target_user=target_user)

	def _on_media_produced(self, data):
		"""Handle media production confirmation from SFU"""
		target_user = data.get("targetUser")
		room_id = data.get("roomId")

		if target_user:
			self.relay_to_client("media_produced", data, target_user=target_user)
		else:
			self.relay_to_client("media_produced", data, room_id=room_id)

	def _on_media_consumed(self, data):
		"""Handle media consumption confirmation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("media_consumed", data, target_user=target_user)

	def _on_producer_paused(self, data):
		"""Handle producer pause confirmation from SFU"""
		target_user = data.get("targetUser")
		room_id = data.get("roomId")

		if target_user:
			self.relay_to_client("producer_paused", data, target_user=target_user)
		else:
			self.relay_to_client("producer_paused", data, room_id=room_id)

	def _on_producer_resumed(self, data):
		"""Handle producer resume confirmation from SFU"""
		target_user = data.get("targetUser")
		room_id = data.get("roomId")

		if target_user:
			self.relay_to_client("producer_resumed", data, target_user=target_user)
		else:
			self.relay_to_client("producer_resumed", data, room_id=room_id)

	def _on_consumer_paused(self, data):
		"""Handle consumer pause confirmation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("consumer_paused", data, target_user=target_user)

	def _on_consumer_resumed(self, data):
		"""Handle consumer resume confirmation from SFU"""
		target_user = data.get("targetUser")
		self.relay_to_client("consumer_resumed", data, target_user=target_user)


# Global SFU connection manager instance
_sfu_manager = None


def get_sfu_manager() -> SFUConnectionManager:
	"""Get the global SFU connection manager instance"""
	global _sfu_manager
	if _sfu_manager is None:
		_sfu_manager = SFUConnectionManager()
		# Auto-connect on first access
		try:
			_sfu_manager.connect_to_sfu()
		except Exception as e:
			logger.warning(f"Failed to auto-connect to SFU: {e!s}")
	return _sfu_manager


def ensure_sfu_connection():
	"""Ensure SFU connection is established"""
	manager = get_sfu_manager()
	if not manager.connected:
		manager.connect_to_sfu()
	return manager
