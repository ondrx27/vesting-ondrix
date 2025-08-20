// frontend/src/hooks/useAutoDistribution.ts
import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface DistributionEvent {
  vestingId: string;
  chain: 'solana' | 'bnb';
  transactionHash: string;
  amount: string;
  timestamp: number;
  recipients: Array<{ wallet: string; amount: string }>;
}

interface AutoDistributionStats {
  totalContracts: number;
  activeContracts: number;
  solanaContracts: number;
  bnbContracts: number;
  isRunning: boolean;
}

interface VestingContract {
  id: string;
  chain: 'solana' | 'bnb';
  address: string;
  beneficiaryAddress: string;
  startTime: number;
  recipients: Array<{ wallet: string; percentage: number }>;
  lastDistributionTime: number;
  isActive: boolean;
}

export const useAutoDistribution = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [stats, setStats] = useState<AutoDistributionStats | null>(null);
  const [contracts, setContracts] = useState<VestingContract[]>([]);
  const [recentDistributions, setRecentDistributions] = useState<DistributionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  // Получаем URL бэкенда из переменных окружения
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

  // Подключение к WebSocket
  useEffect(() => {
    console.log('🔌 [HOOK] Initializing Socket.IO connection to:', backendUrl);
    
    // Создаем подключение Socket.IO
    const socketInstance = io(backendUrl, {
      transports: ['polling'], // Используем только polling для надежности
      timeout: 20000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      withCredentials: false,
      autoConnect: true
    });

    console.log('🔌 [HOOK] Socket instance created');

    let connectTimeout: NodeJS.Timeout;
    let isCleanedUp = false;

    // === ОБРАБОТЧИКИ ПОДКЛЮЧЕНИЯ ===
    socketInstance.on('connect', () => {
      if (isCleanedUp) return;
      
      console.log('🟢 [HOOK] Socket.IO connected successfully!');
      console.log('🆔 [HOOK] Connection ID:', socketInstance.id);
      console.log('🚛 [HOOK] Transport:', (socketInstance as any).io?.engine?.transport?.name || 'unknown');
      
      setIsConnected(true);
      setSocket(socketInstance);
      setError(null);
      setConnectionAttempts(0);
      
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
    });

    socketInstance.on('connect_error', (err) => {
      if (isCleanedUp) return;
      
      console.error('🔴 [HOOK] Connection error:', err);
      
      // Безопасно проверяем дополнительные свойства ошибки
      if ('type' in err) {
        console.error('🔴 [HOOK] Error type:', (err as any).type);
      }
      if ('description' in err) {
        console.error('🔴 [HOOK] Error description:', (err as any).description);
      }
      
      setError(`Connection failed: ${err.message || 'Unknown error'}`);
      setIsConnected(false);
      setConnectionAttempts(prev => prev + 1);
    });

    socketInstance.on('disconnect', (reason) => {
      if (isCleanedUp) return;
      
      console.log('🔴 [HOOK] Disconnected:', reason);
      setIsConnected(false);
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      if (isCleanedUp) return;
      
      console.log('🟡 [HOOK] Reconnected after', attemptNumber, 'attempts');
      setIsConnected(true);
      setError(null);
      setConnectionAttempts(0);
    });

    socketInstance.on('reconnect_error', (err) => {
      if (isCleanedUp) return;
      
      console.error('🔴 [HOOK] Reconnection error:', err);
      setError(`Reconnection failed: ${err.message}`);
    });

    socketInstance.on('reconnect_failed', () => {
      if (isCleanedUp) return;
      
      console.error('🔴 [HOOK] Failed to reconnect after all attempts');
      setError('Failed to reconnect to server');
    });

    socketInstance.on('connection:welcome', (data) => {
      if (isCleanedUp) return;
      
      console.log('📨 [HOOK] Welcome message received:', data);
    });

    socketInstance.on('autoDistribution:status', (data) => {
      if (isCleanedUp) return;
      
      console.log('📊 [HOOK] Status update received:', data);
      if (data && data.stats) {
        setStats(data.stats);
      }
    });

    socketInstance.on('autoDistribution:completed', (event: DistributionEvent) => {
      if (isCleanedUp) return;
      
      console.log('💰 [HOOK] Distribution completed:', event);
      
      setRecentDistributions(prev => [event, ...prev.slice(0, 9)]);
      fetchStats();
      showDistributionNotification(event);
    });

    socketInstance.on('autoDistribution:error', (error) => {
      if (isCleanedUp) return;
      
      console.error('❌ [HOOK] Distribution error:', error);
      setError(`Distribution failed: ${error.error?.message || error.message || 'Unknown error'}`);
    });

    socketInstance.on('autoDistribution:contractAdded', (contract: VestingContract) => {
      if (isCleanedUp) return;
      
      console.log('📋 [HOOK] Contract added:', contract);
      setContracts(prev => [...prev, contract]);
    });

    socketInstance.on('test:response', (data) => {
      if (isCleanedUp) return;
      
      console.log('✅ [HOOK] Test response received:', data);
    });

    socketInstance.onAny((eventName, ...args) => {
      if (isCleanedUp) return;
      
      console.log(`📡 [HOOK] Event received: ${eventName}`, args);
    });

    connectTimeout = setTimeout(() => {
      if (!socketInstance.connected && !isCleanedUp) {
        console.log('⚠️ [HOOK] Connection timeout after 20 seconds');
        setError('Connection timeout - server may be busy');
      }
    }, 20000);

    console.log('🔌 [HOOK] Attempting to connect...');
    socketInstance.connect();

    return () => {
      console.log('🔌 [HOOK] Cleaning up socket connection');
      isCleanedUp = true;
      
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
      
      if (socketInstance) {
        socketInstance.removeAllListeners();
        socketInstance.disconnect();
      }
    };
  }, [backendUrl]);

  const fetchStats = useCallback(async () => {
    try {
      console.log('📊 [HOOK] Fetching stats from:', `${backendUrl}/api/auto-distribution/status`);
      
      const response = await fetch(`${backendUrl}/api/auto-distribution/status`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📊 [HOOK] Stats response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📊 [HOOK] Stats data received:', data);
      
      if (data.success) {
        setStats(data.data);
        console.log('📊 [HOOK] Stats updated successfully');
      } else {
        throw new Error(data.error || 'Failed to fetch stats');
      }
    } catch (error: any) {
      console.error('❌ [HOOK] Error fetching stats:', error);
      setError(`Failed to fetch stats: ${error.message}`);
    }
  }, [backendUrl]);

  const fetchContracts = useCallback(async () => {
    try {
      console.log('📋 [HOOK] Fetching contracts from:', `${backendUrl}/api/auto-distribution/contracts`);
      
      const response = await fetch(`${backendUrl}/api/auto-distribution/contracts`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📋 [HOOK] Contracts response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('📋 [HOOK] Contracts data received:', data);
      
      if (data.success) {
        setContracts(data.data);
        console.log('📋 [HOOK] Contracts updated successfully');
      } else {
        throw new Error(data.error || 'Failed to fetch contracts');
      }
    } catch (error: any) {
      console.error('❌ [HOOK] Error fetching contracts:', error);
      setError(`Failed to fetch contracts: ${error.message}`);
    }
  }, [backendUrl]);

  const controlService = useCallback(async (action: 'start' | 'stop') => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log(`🎮 [HOOK] ${action}ing service...`);
      
      const response = await fetch(`${backendUrl}/api/auto-distribution/control`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      console.log(`🎮 [HOOK] Control response status:`, response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`🎮 [HOOK] Control response:`, data);
      
      if (data.success) {
        await fetchStats();
        console.log(`✅ [HOOK] Service ${action}ed successfully`);
      } else {
        throw new Error(data.error || `Failed to ${action} service`);
      }
    } catch (error: any) {
      const errorMessage = `Failed to ${action} service: ${error.message}`;
      console.error(`❌ [HOOK] ${errorMessage}`);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl, fetchStats]);

  const showDistributionNotification = useCallback((event: DistributionEvent) => {
    console.log(`🎉 [HOOK] Showing notification for distribution:`, event);
    
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Токены распределены! 💰', {
          body: `Распределено ${event.amount} токенов на ${event.chain.toUpperCase()}`,
          icon: '/favicon.ico',
        });
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            new Notification('Токены распределены! 💰', {
              body: `Распределено ${event.amount} токенов на ${event.chain.toUpperCase()}`,
              icon: '/favicon.ico',
            });
          }
        });
      }
    }
  }, []);

  const testConnection = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('🧪 [HOOK] Testing connection to:', `${backendUrl}/api/health`);
      
      const response = await fetch(`${backendUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      
      console.log('🧪 [HOOK] Health check response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('✅ [HOOK] Connection test successful:', data);
      
      if (!isConnected && socket) {
        console.log('🧪 [HOOK] Testing WebSocket with test message...');
        socket.emit('test', { message: 'Connection test from hook', timestamp: Date.now() });
      }
      
      return data;
    } catch (error: any) {
      console.error('❌ [HOOK] Connection test failed:', error);
      setError(`Connection test failed: ${error.message}`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl, isConnected, socket]);

  useEffect(() => {
    if (isConnected) {
      console.log('🚀 [HOOK] Socket connected, initializing data...');
      
      Promise.all([
        fetchStats(),
        fetchContracts(),
      ]).then(() => {
        console.log('✅ [HOOK] Initial data loaded successfully');
      }).catch((error) => {
        console.error('❌ [HOOK] Failed to load initial data:', error);
      });
      
      if (socket) {
        console.log('📡 [HOOK] Requesting status update via WebSocket...');
        socket.emit('autoDistribution:getStatus');
        
        setTimeout(() => {
          console.log('🧪 [HOOK] Sending test message via WebSocket...');
          socket.emit('test', { 
            message: 'Test from hook initialization', 
            timestamp: Date.now() 
          });
        }, 1000);
      }
    }
  }, [isConnected, fetchStats, fetchContracts, socket]);

  useEffect(() => {
    if (!isConnected) return;
    
    console.log('⏰ [HOOK] Setting up periodic data refresh');
    
    const interval = setInterval(() => {
      console.log('⏰ [HOOK] Periodic stats refresh');
      fetchStats();
    }, 30000); 
    
    return () => {
      console.log('⏰ [HOOK] Clearing periodic refresh');
      clearInterval(interval);
    };
  }, [isConnected, fetchStats]);

  useEffect(() => {
    console.log('🔄 [HOOK] Connection state changed:', { isConnected, socketId: socket?.id });
  }, [isConnected, socket]);

  useEffect(() => {
    console.log('📊 [HOOK] Stats state changed:', stats);
  }, [stats]);

  useEffect(() => {
    console.log('📋 [HOOK] Contracts state changed:', contracts?.length || 0, 'contracts');
  }, [contracts]);

  useEffect(() => {
    if (error) {
      console.error('❌ [HOOK] Error state changed:', error);
    }
  }, [error]);

  return {
    isConnected,
    socket,
    connectionAttempts,
    
    stats,
    contracts,
    recentDistributions,
    
    isLoading,
    error,
    
    controlService: {
      start: () => controlService('start'),
      stop: () => controlService('stop'),
    },
    
    refresh: {
      stats: fetchStats,
      contracts: fetchContracts,
    },
    
    testConnection,
    clearError: () => setError(null),
    
    backendUrl,
  };
};