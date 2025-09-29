require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const jwt = require('jsonwebtoken');
const MediasoupManager = require('./mediasoup-manager');

class SFUServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["*"],
        credentials: false
      },
      // Add transport configuration
      transports: ['websocket', 'polling'],
      // Add ping/pong configuration
      pingTimeout: 60000,
      pingInterval: 25000,
      // Allow origins
      allowEIO3: true
    });
    
    this.mediasoup = new MediasoupManager();
    this.port = process.env.PORT || 3000;
    this.host = process.env.HOST || '0.0.0.0';
    console.log(`SFU Server will run on http://${this.host}:${this.port}`);
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-secret';
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
  this.app.get('/', (req, res) => {
      res.json({
    message: 'Frappe Meet SFU Server is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        rooms: this.mediasoup.getAllRoomsStats()
      });
    });

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        rooms: this.mediasoup.rooms.size,
        peers: this.mediasoup.peers.size
      });
    });

    this.app.get('/rooms', (req, res) => {
      res.json({
        rooms: this.mediasoup.getAllRoomsStats()
      });
    });
  }

  async handleJoinRoom(socket, data) {
    try {
      const { roomId, participantId, userData } = data;
      
      console.log(`🏠 Handling join room for user ${participantId} in room ${roomId}`);
      
      // Ensure room exists
      let room = this.mediasoup.rooms.get(roomId);
      if (!room) {
        console.log(`📝 Creating new room: ${roomId}`);
        room = await this.mediasoup.createRoom(roomId);
      } else {
        console.log(`📝 Room ${roomId} already exists`);
      }
      
      // Add peer to room
      console.log(`👤 Adding peer ${participantId} to room ${roomId}`);
      await this.mediasoup.addPeer(roomId, participantId, userData);
      
      socket.join(roomId);
      socket.roomId = roomId;
      socket.participantId = participantId;
      
      socket.to(roomId).emit('participant_joined', { 
        roomId, 
        participantId, 
        userData 
      });
      
      console.log(`✅ Peer ${participantId} joined room ${roomId}`);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error joining room:', error);
      throw error;
    }
  }

  setupSocketHandlers() {
    // JWT Authentication middleware for socket connections
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        
        if (!token) {
          console.error('❌ No authentication token provided');
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, this.jwtSecret);
        
        // Attach user info to socket
        socket.userId = decoded.user_id;
        socket.userName = decoded.user_name;
        socket.meetingId = decoded.meeting_id;
        
        console.log(`✅ Authenticated user: ${socket.userId} for meeting: ${socket.meetingId}`);
        next();
        
      } catch (error) {
        console.error('❌ Authentication failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', async (socket) => {
      console.log(`🔌 New authenticated connection: ${socket.id} (User: ${socket.userId})`);

      // Auto-join the meeting room based on JWT
      const roomId = socket.meetingId;
      if (roomId) {
        try {
          await this.handleJoinRoom(socket, {
            roomId: roomId,
            participantId: socket.userId,
            userData: {
              name: socket.userName,
              userId: socket.userId,
              // Avatar is optionally present in JWT; surface it for participants
              avatar: socket.handshake?.auth?.token ? (() => { try { return (jwt.decode(socket.handshake.auth.token)||{}).user_avatar } catch(_) { return undefined } })() : undefined
            }
          });
          console.log(`✅ User ${socket.userId} successfully joined room ${roomId}`);
        } catch (error) {
          console.error(`❌ Failed to auto-join user ${socket.userId} to room ${roomId}:`, error);
        }
      }

      // Room management - simplified since auth is handled by JWT
      // Direct WebRTC operations - no room management needed, auth handled by JWT
      socket.on('get_router_rtp_capabilities', async (data, callback) => {
        try {
          const roomId = socket.meetingId;
          
          console.log(`🔍 Getting RTP capabilities for room: ${roomId}, user: ${socket.userId}`);
          
          // Room and peer should already exist from auto-join during connection
          const room = this.mediasoup.rooms.get(roomId);
          if (!room) {
            throw new Error(`Room ${roomId} not found - user should be auto-joined on connection`);
          }
          
          const rtpCapabilities = this.mediasoup.getRouterRtpCapabilities(roomId);
          
          if (callback) callback({ success: true, rtpCapabilities });
        } catch (error) {
          console.error('❌ Error getting RTP capabilities:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('create_webrtc_transport', async (data, callback) => {
        try {
          const { direction } = data;
          const roomId = socket.meetingId;
          const userId = socket.userId;
          
          const transportParams = await this.mediasoup.createWebRtcTransport(
            roomId, userId, direction
          );
          
          if (callback) callback({ success: true, ...transportParams });
        } catch (error) {
          console.error('❌ Error creating WebRTC transport:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('connect_webrtc_transport', async (data, callback) => {
        try {
          const { transportId, dtlsParameters } = data;
          await this.mediasoup.connectWebRtcTransport(transportId, dtlsParameters);
          
          if (callback) callback({ success: true });
        } catch (error) {
          console.error('❌ Error connecting WebRTC transport:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('create_producer', async (data, callback) => {
        try {
          const { transportId, rtpParameters, kind, appData = {} } = data;
          const producer = await this.mediasoup.createProducer(
            transportId, rtpParameters, kind, appData
          );

          const isScreen = (producer.appData && producer.appData.type === 'screen') || appData.type === 'screen';
          // Ensure peer info reflects this new producer's active state immediately
          try {
            const room = this.mediasoup.rooms.get(socket.meetingId);
            const peer = room?.peers.get(socket.userId);
            if (peer) {
              peer.info = peer.info || {};
              if (kind === 'audio') peer.info.audio_enabled = !producer.paused;
              if (kind === 'video' && !isScreen) peer.info.video_enabled = !producer.paused;
            }
          } catch (e) {
            console.warn('⚠️ Unable to set peer info flags for new producer', e.message);
          }
          
          if (callback) callback({ success: true, ...producer, isScreen });
          
          // Notify other peers about new producer
          const roomId = socket.meetingId;
          socket.to(roomId).emit('producer_created', {
            roomId: roomId,
            participantId: socket.userId,  // Use participantId for consistency
            producerId: producer.id,       // Use producerId for consistency
            kind: producer.kind,
            paused: !!producer.paused,
            isScreen: isScreen
          });
        } catch (error) {
          console.error('❌ Error creating producer:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('create_consumer', async (data, callback) => {
        try {
          const { transportId, producerId, rtpCapabilities } = data;
          const consumer = await this.mediasoup.createConsumer(
            transportId, producerId, rtpCapabilities
          );
          
          if (callback) callback({ success: true, ...consumer });
        } catch (error) {
          console.error('❌ Error creating consumer:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('close_producer', async (data, callback) => {
        try {
          const { producerId } = data;
          const result = await this.mediasoup.closeProducer(producerId);

          if (callback) callback({ success: true, ...result });

          // Notify other peers about producer close
          const roomId = socket.meetingId;
          socket.to(roomId).emit('producer_closed', {
            roomId: roomId,
            participantId: socket.userId,
            producerId,
            isScreen: !!result?.isScreen
          });

          try {
            const removed = result?.removedConsumers || [];
            for (const rc of removed) {
              const targetPeerSocket = Array.from(this.io.sockets.sockets.values()).find(s => s.userId === rc.peerId && s.meetingId === rc.roomId);
              if (targetPeerSocket) {
                targetPeerSocket.emit('consumer_closed', { consumerId: rc.consumerId });
              } else {
                // if no peer found, just let everyone know
                socket.to(roomId).emit('consumer_closed', { consumerId: rc.consumerId, peerId: rc.peerId });
              }
            }
          } catch (e) {
            console.warn('⚠️ Failed to emit consumer_closed notifications', e.message);
          }
        } catch (error) {
          console.error('❌ Error closing producer:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('close_consumer', async (data, callback) => {
        try {
          const { consumerId } = data;
          await this.mediasoup.closeConsumer(consumerId);
          
          if (callback) callback({ success: true });
        } catch (error) {
          console.error('❌ Error closing consumer:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('get_existing_producers', async (data, callback) => {
        try {
          const roomId = socket.meetingId;
          const userId = socket.userId;
          
          console.log(`📋 Getting existing producers for room: ${roomId}, user: ${userId}`);
          
          const producers = await this.mediasoup.getExistingProducers(roomId, userId);
          
          if (callback) callback({ success: true, producers });
          
          // Also emit producer_created events for each existing producer
          // so the new participant can subscribe to them
          producers.forEach(producer => {
            socket.emit('producer_created', {
              roomId: producer.roomId,
              producerId: producer.id,
              participantId: producer.user_id,
              kind: producer.kind,
              paused: !!producer.paused,
              isScreen: !!producer.isScreen
            });
          });
          
          console.log(`✅ Sent ${producers.length} existing producers to ${userId}`);
        } catch (error) {
          console.error('❌ Error getting existing producers:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on('get_room_participants', async (data, callback) => {
        try {
          const roomId = socket.meetingId;
          const participants = this.mediasoup.getRoomParticipants(roomId);
          if (callback) callback({ success: true, participants });
        } catch (error) {
          console.error('❌ Error getting room participants:', error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      // WebRTC signaling relay - simplified since we have auth context
      socket.on('webrtc_offer', (data) => {
        const { targetUser, signalData } = data;
        const roomId = socket.meetingId;
        socket.to(roomId).emit('webrtc_offer', {
          fromUser: socket.userId,
          targetUser,
          signalData
        });
      });

      socket.on('webrtc_answer', (data) => {
        const { targetUser, signalData } = data;
        const roomId = socket.roomId;
        socket.to(roomId).emit('webrtc_answer', {
          fromUser: socket.participantId,
          targetUser,
          signalData
        });
      });

      socket.on('ice_candidate', (data) => {
        const { targetUser, signalData } = data;
        const roomId = socket.roomId;
        socket.to(roomId).emit('ice_candidate', {
          fromUser: socket.participantId,
          targetUser,
          signalData
        });
      });

      // Media control
      socket.on('media_control', async (data) => {
        const { action } = data;
        const roomId = socket.roomId;
        // Apply on server: update flags + pause/resume local producers
        try {
          await this.mediasoup.applyMediaControl(roomId, socket.participantId, action);
        } catch (e) {
          console.warn('⚠️ Failed to apply media control on server:', e.message);
        }
        // Notify other peers (exclude sender)
        socket.to(roomId).emit('media_control_update', {
          participantId: socket.participantId,
          action,
          timestamp: new Date().toISOString()
        });
      });

      // Screen sharing
      socket.on('screen_share', (data) => {
        const { action, shareData } = data;
        const roomId = socket.roomId;
        
        if (action === 'start_share') {
          socket.to(roomId).emit('screen_share_started', {
            participantId: socket.participantId,
            shareData,
            timestamp: new Date().toISOString()
          });
        } else if (action === 'stop_share') {
          socket.to(roomId).emit('screen_share_stopped', {
            participantId: socket.participantId,
            timestamp: new Date().toISOString()
          });
        }
      });

      socket.on('chat:send', (data = {}) => {
        try {
          const roomId = socket.roomId;
          const text = (typeof data.message === 'string' ? data.message : '')
            .slice(0, 2000);
            
          if (!roomId || !text.trim()) {
            return;
          }

          const payload = {
            roomId,
            message: text,
            fromUser: socket.participantId,
            fromName: socket.userName,
            timestamp: new Date().toISOString(),
          };
          if (data.clientId) payload.clientId = String(data.clientId);

          socket.to(roomId).emit('chat:message', payload);
        } catch (e) {
          console.warn('⚠️ chat:send handling failed:', e?.message || e);
        }
      });

      socket.on('connect', async () => {
        console.log(`🔌 Connected: ${socket.id} (User: ${socket.participantId})`);
      });

      // Disconnect handling
      socket.on('leave_room', async (data = {}) => {
        const roomId = socket.roomId || data.roomId;
        const participantId = socket.participantId;
        if (roomId && participantId) {
          try {
            await this.mediasoup.removePeer(roomId, participantId);
            socket.to(roomId).emit('participant_left', { roomId, participantId });
            socket.leave(roomId);
            socket.roomId = null;
            console.log(`🚪 ${participantId} left room ${roomId}`);
          } catch (e) {
            console.warn('⚠️ leave_room cleanup failed:', e?.message || e);
          }
        }
      });

      socket.on('disconnect', async () => {
        console.log(`🔌 Disconnected: ${socket.id} (User: ${socket.participantId})`);
        
        const roomId = socket.roomId;
        const participantId = socket.participantId;
        
        if (roomId && participantId) {
          try {
            await this.mediasoup.removePeer(roomId, participantId);
            
            socket.to(roomId).emit('participant_left', {
              roomId: roomId,
              participantId: participantId
            });
            
            console.log(`✅ Cleaned up user ${participantId} from room ${roomId}`);
          } catch (error) {
            console.error('❌ Error handling disconnect:', error);
          }
        }
      });

      // Error handling
      socket.on('error', (error) => {
        console.error(`❌ Socket error for ${socket.id}:`, error);
        socket.emit('sfu_error', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });
    });
  }

  async start() {
    try {
      console.log('🚀 Starting SFU Server...');
      
      // Initialize mediasoup
      await this.mediasoup.init();
      
      // Start HTTP server
      this.server.listen(this.port, this.host, () => {
        console.log(`✅ SFU Server running on http://${this.host}:${this.port}`);
      });
      
    } catch (error) {
      console.error('❌ Failed to start SFU server:', error);
      process.exit(1);
    }
  }

  async stop() {
    console.log('🛑 Stopping SFU Server...');
    
    try {
      // Use the comprehensive cleanup method
      await this.mediasoup.cleanup();
      
      // Close server
      this.server.close(() => {
        console.log('✅ SFU Server stopped');
      });
    } catch (error) {
      console.error('❌ Error during server shutdown:', error);
      // Force close if cleanup fails
      this.server.close(() => {
        console.log('✅ SFU Server force stopped');
      });
    }
  }
}

// Create and start server
const sfuServer = new SFUServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await sfuServer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await sfuServer.stop();
  process.exit(0);
});

// Start the server
sfuServer.start().catch((error) => {
  console.error('❌ Failed to start SFU server:', error);
  process.exit(1);
});

module.exports = SFUServer;
