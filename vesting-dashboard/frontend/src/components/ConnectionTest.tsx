// frontend/src/components/ConnectionTest.tsx
import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface ConnectionInfo {
  socketId: string;
  transport: string;
  connected: boolean;
  timestamp: string;
  totalConnections: number;
}

export const ConnectionTest: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [testResults, setTestResults] = useState<any[]>([]);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`${timestamp}: ${message}`, ...prev.slice(0, 19)]);
  };

  const testApiEndpoint = async (endpoint: string) => {
    try {
      addLog(`Testing ${endpoint}...`);
      const response = await fetch(`${backendUrl}${endpoint}`);
      const data = await response.json();
      
      setTestResults(prev => [...prev, {
        endpoint,
        status: response.status,
        success: response.ok,
        data: JSON.stringify(data, null, 2)
      }]);
      
      addLog(`✅ ${endpoint} - Status: ${response.status}`);
    } catch (error: any) {
      addLog(`❌ ${endpoint} - Error: ${error.message}`);
      setTestResults(prev => [...prev, {
        endpoint,
        status: 'ERROR',
        success: false,
        data: error.message
      }]);
    }
  };

  const connectSocket = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }

    addLog('🔌 Attempting Socket.IO connection...');
    
    const newSocket = io(backendUrl, {
      transports: ['polling'],  
      upgrade: true,            
      timeout: 10000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
    });

    newSocket.on('connect', () => {
      addLog('🟢 Socket.IO connected!');
      addLog(`Transport: ${newSocket.io.engine.transport.name}`);
      setIsConnected(true);
      setSocket(newSocket);
      
      newSocket.emit('connection:info');
    });

    newSocket.on('connect_error', (error) => {
      addLog(`🔴 Connection error: ${error.message}`);
      setIsConnected(false);
    });

    newSocket.on('disconnect', (reason) => {
      addLog(`🔴 Disconnected: ${reason}`);
      setIsConnected(false);
    });

    newSocket.on('connection:welcome', (data) => {
      addLog(`📨 Welcome message: ${data.message}`);
    });

    newSocket.on('connection:info', (info: ConnectionInfo) => {
      addLog(`📊 Connection info received`);
      setConnectionInfo(info);
    });

    newSocket.on('test:response', (data) => {
      addLog(`✅ Test response: ${data.message}`);
    });

    newSocket.io.engine.on('upgrade', () => {
      addLog(`🔄 Transport upgraded to: ${newSocket.io.engine.transport.name}`);
    });

    setSocket(newSocket);
  };

  const disconnectSocket = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
      addLog('🔌 Socket disconnected manually');
    }
  };

  const sendTestMessage = () => {
    if (socket && isConnected) {
      const testData = {
        message: 'Test from frontend',
        timestamp: new Date().toISOString()
      };
      socket.emit('test', testData);
      addLog('📤 Test message sent');
    } else {
      addLog('❌ Socket not connected');
    }
  };

  const runAllTests = async () => {
    setTestResults([]);
    addLog('🧪 Running comprehensive tests...');
    
    await testApiEndpoint('/api/health');
    await testApiEndpoint('/api/socket/health');
    await testApiEndpoint('/api/auto-distribution/status');
    await testApiEndpoint('/api/auto-distribution/contracts');
    
    addLog('✅ API tests completed');
  };

  const clearLogs = () => {
    setLogs([]);
    setTestResults([]);
  };

  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2>🔧 Connection Test Dashboard</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <strong>Backend URL:</strong> {backendUrl}
      </div>

      {/* Control Buttons */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button 
          onClick={connectSocket}
          style={{ padding: '10px 15px', backgroundColor: '#00ff88', color: '#000', border: 'none', borderRadius: '5px' }}
        >
          Connect Socket.IO
        </button>
        
        <button 
          onClick={disconnectSocket}
          disabled={!isConnected}
          style={{ padding: '10px 15px', backgroundColor: '#ff4444', color: '#fff', border: 'none', borderRadius: '5px' }}
        >
          Disconnect
        </button>
        
        <button 
          onClick={sendTestMessage}
          disabled={!isConnected}
          style={{ padding: '10px 15px', backgroundColor: '#0088ff', color: '#fff', border: 'none', borderRadius: '5px' }}
        >
          Send Test Message
        </button>
        
        <button 
          onClick={runAllTests}
          style={{ padding: '10px 15px', backgroundColor: '#ff8800', color: '#fff', border: 'none', borderRadius: '5px' }}
        >
          Test API Endpoints
        </button>
        
        <button 
          onClick={clearLogs}
          style={{ padding: '10px 15px', backgroundColor: '#666', color: '#fff', border: 'none', borderRadius: '5px' }}
        >
          Clear Logs
        </button>
      </div>

      {/* Connection Status */}
      <div style={{ 
        padding: '15px', 
        backgroundColor: isConnected ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)',
        border: `1px solid ${isConnected ? '#00ff88' : '#ff4444'}`,
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h3>Connection Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</h3>
        {connectionInfo && (
          <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>
            <div>Socket ID: {connectionInfo.socketId}</div>
            <div>Transport: {connectionInfo.transport}</div>
            <div>Total Connections: {connectionInfo.totalConnections}</div>
            <div>Timestamp: {connectionInfo.timestamp}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Logs */}
        <div>
          <h3>📝 Connection Logs</h3>
          <div style={{ 
            height: '400px', 
            overflowY: 'auto', 
            backgroundColor: '#1a1a1a', 
            padding: '15px', 
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ccc'
          }}>
            {logs.length === 0 ? (
              <div>No logs yet...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} style={{ marginBottom: '5px' }}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Test Results */}
        <div>
          <h3>🧪 API Test Results</h3>
          <div style={{ 
            height: '400px', 
            overflowY: 'auto', 
            backgroundColor: '#1a1a1a', 
            padding: '15px', 
            borderRadius: '8px'
          }}>
            {testResults.length === 0 ? (
              <div style={{ color: '#888' }}>Run tests to see results...</div>
            ) : (
              testResults.map((result, index) => (
                <div key={index} style={{ 
                  marginBottom: '15px',
                  padding: '10px',
                  backgroundColor: result.success ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)',
                  borderRadius: '5px'
                }}>
                  <div style={{ fontWeight: 'bold', color: result.success ? '#00ff88' : '#ff4444' }}>
                    {result.endpoint} - {result.status}
                  </div>
                  <pre style={{ 
                    fontSize: '11px', 
                    color: '#ccc', 
                    marginTop: '5px',
                    maxHeight: '100px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {result.data}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};