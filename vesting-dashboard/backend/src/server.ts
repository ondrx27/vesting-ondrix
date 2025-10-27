// backend/src/server.ts
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import AutoDistributionService from './services/AutoDistributionService';
import { 
  sanitizeRequestBody, 
  sanitizeHeaders, 
  sanitizeQueryParams, 
  securityHeaders, 
  requestSizeLimit 
} from './middleware/security';
import { ErrorHandler } from './utils/errorHandler';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    methods: ["GET", "POST"],
    credentials: false,
    allowedHeaders: ["*"]
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowRequest: (req, callback) => {
    callback(null, true);
  }
});

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Security middleware - apply early in middleware stack
app.use(securityHeaders);
app.use(requestSizeLimit(1024 * 1024)); // 1MB limit
app.use(sanitizeHeaders);

app.use(express.json({ limit: '1mb' })); // Reduced from 10mb for security
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Apply sanitization after body parsing
app.use(sanitizeRequestBody);
app.use(sanitizeQueryParams);

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const autoDistribution = new AutoDistributionService();

autoDistribution.on('serviceStarted', () => {
  console.log('🟢 Auto distribution service started');
  io.emit('autoDistribution:status', { 
    status: 'started',
    stats: autoDistribution.getStats(),
    timestamp: new Date().toISOString()
  });
});

autoDistribution.on('serviceStopped', () => {
  console.log('🔴 Auto distribution service stopped');
  io.emit('autoDistribution:status', { 
    status: 'stopped',
    stats: autoDistribution.getStats(),
    timestamp: new Date().toISOString()
  });
});

autoDistribution.on('distribution', (event) => {
  console.log('💰 Distribution completed:', event);
  
  io.emit('autoDistribution:completed', event);
  
  saveDistributionToDatabase(event);
});

autoDistribution.on('distributionError', (error) => {
  console.error('❌ Distribution error:', error);
  io.emit('autoDistribution:error', error);
});

autoDistribution.on('contractAdded', (contract) => {
  console.log('📋 New contract added for monitoring:', contract.id);
  io.emit('autoDistribution:contractAdded', contract);
});

autoDistribution.on('error', (error) => {
  console.error('🚨 Auto distribution service error:', error);
  io.emit('autoDistribution:error', { 
    message: 'Service error',
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  const stats = autoDistribution.getStats();
  res.json({ 
    status: 'healthy',
    success: true, 
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    autoDistribution: stats,
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    socketConnections: io.engine.clientsCount || 0
  });
});

app.get('/api/socket/health', (req, res) => {
  res.json({
    success: true,
    socketio: {
      connected: io.engine.clientsCount || 0,
      transports: ['polling', 'websocket'],
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000"
      }
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/auto-distribution/status', (req, res) => {
  try {
    const stats = autoDistribution.getStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error getting auto distribution status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/auto-distribution/contracts', (req, res) => {
  try {
    const contracts = autoDistribution.getVestingContracts();
    res.json({
      success: true,
      data: contracts,
      count: contracts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error getting contracts:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/auto-distribution/contracts', (req, res) => {
  try {
    const { chain, address, beneficiaryAddress, startTime, recipients } = req.body;
    
    if (!chain || !address || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: chain, address, recipients',
        timestamp: new Date().toISOString()
      });
    }
    
    if (!['solana', 'bnb'].includes(chain)) {
      return res.status(400).json({
        success: false,
        error: 'Chain must be either "solana" or "bnb"',
        timestamp: new Date().toISOString()
      });
    }
    
    const totalPercentage = recipients.reduce((sum: number, r: any) => sum + (r.percentage || 0), 0);
    if (totalPercentage !== 100) {
      return res.status(400).json({
        success: false,
        error: `Recipient percentages must sum to 100%. Current sum: ${totalPercentage}%`,
        timestamp: new Date().toISOString()
      });
    }
    
    const contractId = autoDistribution.addVestingContract({
      chain,
      address,
      beneficiaryAddress: beneficiaryAddress || 'auto',
      startTime: startTime || Math.floor(Date.now() / 1000),
      recipients,
      lastDistributionTime: 0,
      isActive: true,
      distributedPeriods: new Set<number>(),
      totalDistributed: '0',
      lastCheckedAmount: '0'
    });

    res.json({
      success: true,
      data: { contractId },
      message: 'Contract added for automatic distribution',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Error adding contract:', error);
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/auto-distribution/control', async (req, res) => {
  try {
    const { action } = req.body;
    
    if (!action || !['start', 'stop'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use "start" or "stop"',
        timestamp: new Date().toISOString()
      });
    }
    
    if (action === 'start') {
      await autoDistribution.start();
      res.json({
        success: true,
        message: 'Auto distribution service started',
        stats: autoDistribution.getStats(),
        timestamp: new Date().toISOString()
      });
    } else if (action === 'stop') {
      await autoDistribution.stop();
      res.json({
        success: true,
        message: 'Auto distribution service stopped',
        stats: autoDistribution.getStats(),
        timestamp: new Date().toISOString()
      });
    }

  } catch (error: any) {
    console.error(`Error ${req.body.action}ing service:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/auto-distribution/reset/:contractId', (req, res) => {
  try {
    const { contractId } = req.params;
    const success = autoDistribution.resetDistributionState(contractId);
    
    if (success) {
      res.json({
        success: true,
        message: `Distribution state reset for contract ${contractId}`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: `Contract ${contractId} not found`,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: any) {
    console.error('Error resetting distribution state:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/test/socket', (req, res) => {
  try {
    const testMessage = {
      message: 'Test from API',
      timestamp: new Date().toISOString(),
      connectedClients: io.engine.clientsCount || 0
    };
    
    io.emit('test:broadcast', testMessage);
    
    res.json({
      success: true,
      message: 'Test message sent via Socket.IO',
      data: testMessage
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Global error handler - must be last middleware
app.use(ErrorHandler.globalErrorHandler());

io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);
  console.log('Transport:', socket.conn.transport.name);
  console.log('Total connections:', io.engine.clientsCount);
  
  socket.emit('connection:welcome', {
    message: 'Connected to Auto Distribution Service',
    socketId: socket.id,
    transport: socket.conn.transport.name,
    timestamp: new Date().toISOString()
  });
  
  const currentStats = autoDistribution.getStats();
  socket.emit('autoDistribution:status', {
    status: currentStats.isRunning ? 'running' : 'stopped',
    stats: currentStats,
    timestamp: new Date().toISOString()
  });

  socket.conn.on('upgrade', () => {
    console.log('🔄 Transport upgraded to:', socket.conn.transport.name);
  });

  socket.on('disconnect', (reason) => {
    console.log('👤 Client disconnected:', socket.id, 'Reason:', reason);
    console.log('Remaining connections:', io.engine.clientsCount - 1);
  });

  socket.on('autoDistribution:getStatus', () => {
    const stats = autoDistribution.getStats();
    socket.emit('autoDistribution:status', {
      status: stats.isRunning ? 'running' : 'stopped',
      stats: stats,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('test', (data) => {
    console.log('📝 Test event received from', socket.id, ':', data);
    socket.emit('test:response', { 
      message: 'Test successful', 
      originalData: data,
      timestamp: new Date().toISOString(),
      socketId: socket.id
    });
  });

  socket.on('connection:info', () => {
    socket.emit('connection:info', {
      socketId: socket.id,
      transport: socket.conn.transport.name,
      connected: socket.connected,
      timestamp: new Date().toISOString(),
      totalConnections: io.engine.clientsCount
    });
  });

  socket.on('error', (error) => {
    console.error('🔴 Socket error from', socket.id, ':', error);
  });
});

io.engine.on('connection_error', (err) => {
  console.error('🔴 Socket.IO connection error:', err);
});

async function saveDistributionToDatabase(event: any) {
  try {
    console.log('💾Distribution to info:', {
      vestingId: event.vestingId,
      chain: event.chain,
      transactionHash: event.transactionHash,
      amount: event.amount,
      timestamp: event.timestamp,
      recipientCount: event.recipients.length,
      period: event.period
    });
    
    
  } catch (error) {
    console.error('❌ Error saving distribution to database:', error);
  }
}

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server gracefully...');
  
  try {
    await autoDistribution.stop();
    
    io.emit('server:shutdown', {
      message: 'Server is shutting down',
      timestamp: new Date().toISOString()
    });
    
    setTimeout(() => {
      server.close(() => {
        console.log('✅ Server shut down gracefully');
        process.exit(0);
      });
    }, 1000);
    
    setTimeout(() => {
      console.log('⚠️  Forcing server shutdown...');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down...');
  await autoDistribution.stop();
  server.close(() => {
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, async () => {
  console.log('🚀 Server running on:', `http://localhost:${PORT}`);
  console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
  console.log('🔗 Frontend URL:', process.env.FRONTEND_URL || 'http://localhost:3000');
  console.log('📡 Socket.IO transports: polling, websocket');
  console.log('🔒 CORS origins:', [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
  
  try {
    console.log('🔄 Starting auto distribution service...');
    await autoDistribution.start();
    console.log('✅ Auto distribution service started automatically');
  } catch (error) {
    console.error('❌ Failed to start auto distribution service:', error);
    console.log('⚠️  You can start it manually via API: POST /api/auto-distribution/control');
  }
});

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', error);
  }
});

export { app, server, autoDistribution };