const mediasoup = require('mediasoup');
const config = require('./config');

class MediasoupManager {
  constructor() {
    this.workers = [];
    this.routers = new Map();
    this.transports = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.peers = new Map();
    this.rooms = new Map();
    this.nextWorkerIndex = 0;
  }

  async init() {
    console.log('🚀 Initializing Mediasoup...');
    
    // Create workers
    for (let i = 0; i < config.mediasoup.numWorkers; i++) {
      const worker = await mediasoup.createWorker(config.mediasoup.worker);
      
      worker.on('died', () => {
        console.error(`❌ Mediasoup worker ${i + 1} died, initiating cleanup and restart...`);
        
        // Perform cleanup before restarting
        this.cleanup().then(() => {
          console.log('🔄 Cleanup completed, restarting process...');
          setTimeout(() => process.exit(1), 2000);
        }).catch((error) => {
          console.error('❌ Error during cleanup after worker death:', error);
          setTimeout(() => process.exit(1), 1000);
        });
      });

      this.workers.push(worker);
      console.log(`✅ Created worker ${i + 1}/${config.mediasoup.numWorkers}`);
    }

    console.log('✅ Mediasoup initialized successfully');
  }

  getNextWorker() {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async createRoom(roomId) {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }

    console.log(`🏠 Creating room: ${roomId}`);
    
    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });

    const room = {
      id: roomId,
      router,
      peers: new Map(),
      created: new Date(),
    };

    this.rooms.set(roomId, room);
    this.routers.set(roomId, router);

    console.log(`✅ Room created: ${roomId}`);
    return room;
  }

  async closeRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    console.log(`🏠 Closing room: ${roomId}`);
    
    // Close all peers in the room
    for (const [peerId, peer] of room.peers) {
      await this.removePeer(roomId, peerId);
    }

    // Close router
    try {
      room.router.close();
      console.log(`🔀 Router closed for room: ${roomId}`);
    } catch (error) {
      console.warn(`⚠️ Error closing router for room ${roomId}: ${error.message}`);
    }
    
    // Clean up
    this.rooms.delete(roomId);
    this.routers.delete(roomId);

    console.log(`✅ Room closed: ${roomId}`);
  }

  async addPeer(roomId, peerId, peerInfo = {}) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    console.log(`👤 Adding peer ${peerId} to room ${roomId}`);

    // Check if peer already exists
    if (room.peers.has(peerId)) {
      console.log(`⚠️ Peer ${peerId} already exists in room ${roomId}, updating info...`);
      const existingPeer = room.peers.get(peerId);
      existingPeer.info = { ...existingPeer.info, ...peerInfo };
      return existingPeer;
    }

    // Ensure default media state flags
    const normalizedInfo = {
      ...peerInfo,
      audio_enabled:
        typeof peerInfo.audio_enabled === 'boolean' ? peerInfo.audio_enabled : false,
      video_enabled:
        typeof peerInfo.video_enabled === 'boolean' ? peerInfo.video_enabled : false,
      avatar: peerInfo.avatar
    };

    const peer = {
      id: peerId,
      info: normalizedInfo,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      joined: new Date(),
    };

    room.peers.set(peerId, peer);
    this.peers.set(peerId, { roomId, peer });

    console.log(`✅ Peer added: ${peerId}`);
    console.log(`📊 Room ${roomId} now has ${room.peers.size} peers`);
    return peer;
  }

  async removePeer(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    console.log(`👤 Removing peer ${peerId} from room ${roomId}`);

    // Close all transports
    for (const transport of peer.transports.values()) {
      try {
        transport.close();
      } catch (error) {
        console.warn(`⚠️ Error closing transport: ${error.message}`);
      }
    }

    // Close and clean up producers
    for (const producer of peer.producers.values()) {
      try {
        producer.close();
      } catch (error) {
        console.warn(`⚠️ Error closing producer: ${error.message}`);
      }
      this.producers.delete(producer.id);
    }

    // Close and clean up consumers
    for (const consumer of peer.consumers.values()) {
      try {
        consumer.close();
      } catch (error) {
        console.warn(`⚠️ Error closing consumer: ${error.message}`);
      }
      this.consumers.delete(consumer.id);
    }

    // Remove from room and global maps
    room.peers.delete(peerId);
    this.peers.delete(peerId);

    console.log(`✅ Peer removed: ${peerId}`);

    // Close room if empty
    if (room.peers.size === 0) {
      await this.closeRoom(roomId);
    }
  }

  async createWebRtcTransport(roomId, peerId, direction) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const peer = room.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found in room ${roomId}`);
    }

    console.log(`🚚 Creating ${direction} transport for peer ${peerId}`);

    const transport = await room.router.createWebRtcTransport(
      config.mediasoup.webRtcTransport
    );

    // Add event listeners for debugging
    // transport.on('dtlsstatechange', (dtlsState) => {
    //   console.log(`🔐 DTLS state changed to ${dtlsState} for peer ${peerId} transport ${transport.id}`);
    //   if (dtlsState === 'connected') {
    //     console.log(`✅ DTLS handshake completed for transport ${transport.id} - ready for media flow`);
    //   } else if (dtlsState === 'failed') {
    //     console.error(`❌ DTLS failed for peer ${peerId} transport ${transport.id}`);
    //   } else if (dtlsState === 'closed') {
    //     console.log(`🔐 DTLS closed, closing transport ${transport.id}`);
    //     transport.close();
    //   } else if (dtlsState === 'connecting') {
    //     console.log(`🔐 DTLS handshake starting for transport ${transport.id}`);
    //   }
    // });

    // transport.on('icestatechange', (iceState) => {
    //   console.log(`🧊 ICE state changed to ${iceState} for peer ${peerId} transport ${transport.id}`);
    //   if (iceState === 'failed') {
    //     console.error(`❌ ICE failed for peer ${peerId} transport ${transport.id}`);
    //   } else if (iceState === 'disconnected') {
    //     console.warn(`⚠️ ICE disconnected for peer ${peerId} transport ${transport.id}`);
    //   }
    // });

    // transport.on('iceselectedtuplechange', (iceSelectedTuple) => {
    //   console.log(`🧊 ICE selected tuple changed for peer ${peerId}:`, iceSelectedTuple);
    // });

    // transport.on('sctpstatechange', (sctpState) => {
    //   console.log(`📡 SCTP state changed to ${sctpState} for peer ${peerId} transport ${transport.id}`);
    // });

    // Log transport details
    // console.log(`📋 Transport created with details:`, {
    //   id: transport.id,
    //   iceParameters: transport.iceParameters,
    //   iceCandidatesLength: transport.iceCandidates.length,
    //   dtlsParametersRole: transport.dtlsParameters.role
    // });

    // Store transport
    const transportKey = `${direction}-${Date.now()}`;
    peer.transports.set(transportKey, transport);
    this.transports.set(transport.id, { roomId, peerId, transport });

    console.log(`✅ ${direction} transport created for peer ${peerId}`);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectWebRtcTransport(transportId, dtlsParameters) {
    const transportData = this.transports.get(transportId);
    if (!transportData) {
      throw new Error(`Transport ${transportId} not found`);
    }
    
    try {
      await transportData.transport.connect({ dtlsParameters });
      
      // Wait a bit for the DTLS state to potentially change
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Failed to connect transport ${transportId}:`, error);
      console.error(`📋 Transport state on error:`, {
        id: transportData.transport.id,
        connectionState: transportData.transport.connectionState,
        iceState: transportData.transport.iceState,
        dtlsState: transportData.transport.dtlsState
      });
      throw error;
    }
  }

  async createProducer(transportId, rtpParameters, kind, appData = {}) {
    const transportData = this.transports.get(transportId);
    if (!transportData) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const { roomId, peerId, transport } = transportData;
    
    console.log(`🎬 Creating ${kind} producer for peer ${peerId}`);

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData
    });

    const room = this.rooms.get(roomId);
    const peer = room.peers.get(peerId);
    
    peer.producers.set(producer.id, producer);
  this.producers.set(producer.id, { roomId, peerId, producer });

    // Add producer event listeners for debugging
    // producer.on('score', (score) => {
    //   console.log(`📊 Producer ${producer.id} (${kind}) score event:`, score);
    //   if (score.length > 0) {
    //     const scores = score.map(s => s.score);
    //     if (scores.some(s => s < 5)) {
    //       console.warn(`⚠️ Producer ${producer.id} has low score:`, scores);
    //     } else if (scores.some(s => s > 0)) {
    //       console.log(`✅ Producer ${producer.id} has positive score:`, scores);
    //     } else {
    //       console.warn(`⚠️ Producer ${producer.id} has ZERO score - no media flowing:`, scores);
    //     }
    //   }
    // });

    // Monitor producer stats periodically
    // const statsInterval = setInterval(async () => {
    //   try {
    //     const stats = await producer.getStats();
    //     console.log(`📊 Producer ${producer.id} (${kind}) stats:`, {
    //       score: producer.score,
    //       paused: producer.paused,
    //       closed: producer.closed,
    //       bytesReceived: stats.find(s => s.type === 'inbound-rtp')?.bytesReceived || 0,
    //       packetsReceived: stats.find(s => s.type === 'inbound-rtp')?.packetsReceived || 0,
    //       packetsLost: stats.find(s => s.type === 'inbound-rtp')?.packetsLost || 0
    //     });
        
    //     // Check if we're receiving any media
    //     const inboundStats = stats.find(s => s.type === 'inbound-rtp');
    //     if (inboundStats && inboundStats.packetsReceived === 0) {
    //       console.warn(`⚠️ Producer ${producer.id} (${kind}) is not receiving any RTP packets from client!`);
    //     }
    //   } catch (error) {
    //     console.warn(`⚠️ Failed to get producer stats: ${error.message}`);
    //   }
    // }, 5000); // Check every 5 seconds

    // producer.on('close', () => {
    //   clearInterval(statsInterval);
    // });

    producer.on('videoorientationchange', (videoOrientation) => {
      console.log(`📱 Producer ${producer.id} video orientation changed:`, videoOrientation);
    });

    producer.on('pause', () => {
      console.log(`⏸️ Producer ${producer.id} paused`);
    });

    producer.on('resume', () => {
      console.log(`▶️ Producer ${producer.id} resumed`);
    });

  return {
      id: producer.id,
      kind: producer.kind,
      appData: producer.appData || appData || {}
    };
  }

  async createConsumer(transportId, producerId, rtpCapabilities) {
    const transportData = this.transports.get(transportId);
    if (!transportData) {
      console.error(`❌ Transport ${transportId} not found`);
      console.error(`📋 Available transports:`, Array.from(this.transports.keys()));
      throw new Error(`Transport ${transportId} not found`);
    }

    const producerData = this.producers.get(producerId);
    if (!producerData) {
      console.error(`❌ Producer ${producerId} not found`);
      console.error(`📋 Available producers:`, Array.from(this.producers.keys()));
      throw new Error(`Producer ${producerId} not found`);
    }

    const { roomId, peerId, transport } = transportData;
    const room = this.rooms.get(roomId);

    // Validate transport is not closed or failed
    if (transport.closed) {
      throw new Error(`Transport ${transportId} is closed - cannot create consumer`);
    }

    if (transport.dtlsState === 'failed') {
      console.error(`❌ Transport ${transportId} DTLS failed!`);
      throw new Error(`Transport ${transportId} DTLS connection failed`);
    }

    if (transport.dtlsState === 'closed') {
      console.error(`❌ Transport ${transportId} DTLS closed!`);
      throw new Error(`Transport ${transportId} DTLS connection is closed`);
    }
    if (producerData.producer.closed) {
      throw new Error(`Producer ${producerId} is closed - cannot create consumer`);
    }

    const canConsumeResult = room.router.canConsume({
      producerId,
      rtpCapabilities,
    });
    if (!canConsumeResult) {
      console.error(`❌ Router cannot consume producer ${producerId}`);
      console.error(`🔍 Producer RTP capabilities:`, producerData.producer.rtpParameters?.codecs);
      console.error(`🔍 Consumer RTP capabilities:`, rtpCapabilities?.codecs?.map(c => c.mimeType));
      throw new Error(`Router cannot consume producer ${producerId} - RTP capabilities mismatch`);
    }

    try {
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true, // Consumers should start paused by default
      });


      // Add enhanced event listeners for consumer debugging
      consumer.on('transportclose', () => {
        console.log(`🚚 Consumer ${consumer.id} transport closed`);
      });

      consumer.on('producerclose', () => {
        console.log(`🎬 Consumer ${consumer.id} producer closed`);
      });

      consumer.on('producerpause', () => {
        console.log(`⏸️ Consumer ${consumer.id} producer paused`);
      });

      consumer.on('producerresume', () => {
        console.log(`▶️ Consumer ${consumer.id} producer resumed`);
      });

      consumer.on('score', (score) => {
        if (score.score < 5) {
          console.warn(`⚠️ Consumer ${consumer.id} has low score:`, score);
        }
      });

      // consumer.on('layerschange', (layers) => {
      //   console.log(`🎚️ Consumer ${consumer.id} layers changed:`, layers);
      // });

      const peer = room.peers.get(peerId);
      peer.consumers.set(consumer.id, consumer);
      this.consumers.set(consumer.id, { roomId, peerId, consumer });

      console.log(`✅ Consumer ${consumer.id} (${consumer.kind}) created for peer ${peerId} from producer ${producerId}`);
      console.log(`📊 Total consumers in room ${roomId}: ${peer.consumers.size}`);

      if (consumer.paused) {
        await consumer.resume();
      }

      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        paused: consumer.paused,
      };

    } catch (consumeError) {
      console.error(`❌ Failed to create consumer:`, {
        error: consumeError.message,
        producerId,
        transportId,
        transportState: transport.connectionState,
        producerKind: producerData.producer.kind,
        producerClosed: producerData.producer.closed,
      });
      throw consumeError;
    }
  }

  async closeProducer(producerId) {
    const producerData = this.producers.get(producerId);
    if (!producerData) return { isScreen: false };

    const { roomId, peerId, producer } = producerData;
    const isScreen = producer?.appData?.type === 'screen';

    // Find and close any consumers that were consuming from this producer
    const removedConsumers = [];
    try {
      for (const [cid, cdata] of this.consumers.entries()) {
        const c = cdata.consumer;
        try {
          if (c && (c.producerId === producerId || c._producerId === producerId)) {
            const targetPeerId = cdata.peerId;
            try { c.close(); } catch (e) { /* ignore */ }
            const r = this.rooms.get(cdata.roomId);
            if (r) {
              const peerObj = r.peers.get(targetPeerId);
              if (peerObj) peerObj.consumers.delete(cid);
            }
            this.consumers.delete(cid);
            removedConsumers.push({ consumerId: cid, peerId: targetPeerId, roomId: cdata.roomId });
          }
        } catch (e) {
          console.warn('⚠️ Error while closing consumer', cid, e.message);
        }
      }
    } catch (e) {
      console.warn('⚠️ Error while closing related consumers for producer', producerId, e.message);
    }

    try { producer.close(); } catch (_) {}
    
    // Clean up producer references
    const room = this.rooms.get(roomId);
    const peer = room?.peers?.get(peerId);
    if (peer) peer.producers.delete(producerId);
    this.producers.delete(producerId);

    console.log(`✅ Producer closed: ${producerId}${isScreen ? ' (screen)' : ''}`);
    return { isScreen, removedConsumers };
  }

  async closeConsumer(consumerId) {
    const consumerData = this.consumers.get(consumerId);
    if (!consumerData) return;

    const { roomId, peerId, consumer } = consumerData;
    
    consumer.close();
    
    // Clean up
    const room = this.rooms.get(roomId);
    const peer = room.peers.get(peerId);
    peer.consumers.delete(consumerId);
    this.consumers.delete(consumerId);

    console.log(`✅ Consumer closed: ${consumerId}`);
  }

  getRouterRtpCapabilities(roomId) {
    const router = this.routers.get(roomId);
    if (!router) {
      console.error(`❌ Room ${roomId} not found when getting RTP capabilities`);
      console.log(`📋 Available rooms:`, Array.from(this.rooms.keys()));
      throw new Error(`Room ${roomId} not found`);
    }
    
    return router.rtpCapabilities;
  }

  async getExistingProducers(roomId, userId) {
    console.log(`📋 Getting existing producers for room: ${roomId}, excluding user: ${userId}`);

    const existingProducers = [];

    const room = this.rooms.get(roomId);
    if (!room) {
      return existingProducers;
    }

    for (const [peerId, peer] of room.peers) {
      // Exclude requester
      if (peerId === userId) continue;

      for (const producer of peer.producers.values()) {
        existingProducers.push({
          id: producer.id,
          roomId,
          user_id: peerId,
          kind: producer.kind,
          paused: producer.paused,
          isScreen: (producer.appData && producer.appData.type === 'screen') || false,
        });
      }
    }

    // If empty, provide a concise debug snapshot to diagnose timing/mismatch issues
    if (existingProducers.length === 0) {
      const globalInRoom = Array.from(this.producers.values())
        .filter((p) => p.roomId === roomId)
        .map((p) => ({ id: p.producer.id, peerId: p.peerId, kind: p.producer.kind }));

      const roomPeerProducerCounts = Object.fromEntries(
        Array.from(room.peers).map(([pid, p]) => [pid, p.producers.size])
      );
    }

    return existingProducers;
  }

  getRoomStats(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: roomId,
      created: room.created,
      peerCount: room.peers.size,
      peers: Array.from(room.peers.keys()),
    };
  }

  getAllRoomsStats() {
    const stats = [];
    for (const [roomId, room] of this.rooms) {
      stats.push(this.getRoomStats(roomId));
    }
    return stats;
  }

  getRoomParticipants(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.peers.entries()).map(([peerId, peer]) => {
      let audioEnabled = false;
      let videoEnabled = false;
      for (const producer of peer.producers.values()) {
        if (producer.kind === 'audio' && !producer.paused) audioEnabled = true;
        if (producer.kind === 'video' && !producer.paused) videoEnabled = true;
      }
      return {
        id: peerId,
        user_id: peerId,
        info: {
          ...(peer.info || {}),
          audio_enabled: audioEnabled,
            video_enabled: videoEnabled,
            avatar: (peer.info||{}).avatar
        },
      };
    });
  }

  /**
   * Apply a media control action to a peer: update flags and pause/resume producers
   */
  async applyMediaControl(roomId, peerId, action) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const peer = room.peers.get(peerId);
    if (!peer) return;

    const setFlag = (k, v) => {
      peer.info = peer.info || {};
      peer.info[k] = v;
    };

    switch (action) {
      case 'mute':
        setFlag('audio_enabled', false);
        break;
      case 'unmute':
        setFlag('audio_enabled', true);
        break;
      case 'video_off':
        setFlag('video_enabled', false);
        break;
      case 'video_on':
        setFlag('video_enabled', true);
        break;
      default:
        break;
    }
  }

  async cleanup() {
    console.log('🧹 Starting MediaSoup cleanup...');
    
    // Log current state
    const initialStats = {
      rooms: this.rooms.size,
      peers: this.peers.size,
      transports: this.transports.size,
      producers: this.producers.size,
      consumers: this.consumers.size,
      workers: this.workers.length
    };
    console.log('📊 Initial cleanup stats:', initialStats);
    
    // Close all rooms (this will also close peers, transports, producers, consumers)
    console.log(`🏠 Closing ${this.rooms.size} rooms...`);
    for (const roomId of this.rooms.keys()) {
      await this.closeRoom(roomId);
    }
    
    // Close all remaining workers
    console.log(`⚙️ Closing ${this.workers.length} workers...`);
    for (const worker of this.workers) {
      try {
        worker.close();
      } catch (error) {
        console.warn(`⚠️ Error closing worker: ${error.message}`);
      }
    }
    
    // Clear all maps
    this.workers = [];
    this.routers.clear();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
    this.peers.clear();
    this.rooms.clear();
    this.nextWorkerIndex = 0;
    
    // Log final state
    const finalStats = {
      rooms: this.rooms.size,
      peers: this.peers.size,
      transports: this.transports.size,
      producers: this.producers.size,
      consumers: this.consumers.size,
      workers: this.workers.length
    };
    console.log('📊 Final cleanup stats:', finalStats);
    console.log('✅ MediaSoup cleanup completed');
  }
}

module.exports = MediasoupManager;
