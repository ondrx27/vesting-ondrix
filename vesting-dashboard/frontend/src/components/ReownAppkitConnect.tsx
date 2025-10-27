import React from 'react';
import { useReownAppKit } from '../hooks/useReownAppKit';
import { Wallet, AlertTriangle, Zap, Settings, ExternalLink } from 'lucide-react';

interface ReownAppKitConnectProps {
  onConnect: (address: string, provider: any) => void;
  onDisconnect: () => void;
  onFullDisconnect?: () => Promise<void>;
}

export const ReownAppKitConnect: React.FC<ReownAppKitConnectProps> = ({
  onConnect,
  onDisconnect,
  onFullDisconnect
}) => {
  const {
    isConnected,
    address,
    provider,
    isConnecting,
    error,
    chainId,
    openConnectModal,
    openAccountModal,
    switchNetwork,
    disconnect,
    getNetworkInfo,
    isAppKitReady
  } = useReownAppKit();

  // Передаем данные в родительский компонент при подключении
  React.useEffect(() => {
    console.log('🔗 ReownAppKitConnect useEffect:', {
      isConnected,
      address,
      hasProvider: !!provider,
      allReady: !!(isConnected && address)
    });

    // Вызываем onConnect если есть адрес и подключение (provider может прийти позже)
    if (isConnected && address) {
      console.log('Calling onConnect', { address, hasProvider: !!provider });
      onConnect(address, provider);
    } else if (!isConnected && !address) {
      // Если отключились, вызываем onDisconnect
      console.log('Disconnected, calling onDisconnect');
      onDisconnect();
    }
  }, [isConnected, address, provider]);

  const handleConnect = async () => {
    try {
      await openConnectModal();
    } catch (err) {
      console.error('Ошибка открытия модального окна Reown:', err);
    }
  };

  const handleDisconnect = async () => {
    console.log('🚨 HANDLE DISCONNECT CALLED - ReownAppkitConnect');
    try {
      console.log('About to call disconnect() from useReownAppKit...');
      await disconnect();
      console.log('disconnect() completed, calling onDisconnect()...');
      onDisconnect();
    } catch (err) {
      console.error('Ошибка отключения Reown:', err);
    }
  };

  // window.__reownDisconnect уже создан в useReownAppKit хуке, не переопределяем его здесь

  const handleAccountClick = async () => {
    try {
      await openAccountModal();
    } catch (err) {
      console.error('Ошибка открытия модального окна аккаунта:', err);
    }
  };

  const networkInfo = chainId ? getNetworkInfo(chainId) : null;

  if (!isAppKitReady) {
    return (
      <div className="reown-loading">
        <div className="loading-content">
          <div className="spinner" />
          <span>Loading Reown AppKit...</span>
        </div>
        <style>{`
          .reown-loading {
            padding: 20px;
            text-align: center;
            color: #6b7280;
          }
          .loading-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
          }
          .reown-loading .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #e5e7eb;
            border-top: 2px solid #3b82f6;
            border-radius: 50%;
            animation: reown-loading-spin 1s linear infinite;
          }
          @keyframes reown-loading-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="reown-appkit-connect">
      {error && (
        <div className="error-message">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {isConnected && address ? (
        <div className="connected-status">
          <div className="connection-info">
            <Zap size={18} className="connection-icon" />
            <div className="connection-details">
              <div className="connection-label">Connected via Reown</div>
              <div className="connection-address">
                {`${address.slice(0, 6)}...${address.slice(-4)}`}
              </div>
              {networkInfo && (
                <div className="network-info">
                  <span className="network-name">{networkInfo.name}</span>
                  <span className="network-symbol">({networkInfo.symbol})</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="connection-actions">
            <button 
              onClick={handleAccountClick}
              className="account-btn"
              title="Настройки аккаунта"
            >
              <Settings size={16} />
            </button>
            <button 
              onClick={handleDisconnect}
              className="disconnect-btn"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="button-container">
          <button 
            className="connect-btn reown-btn"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <>
                <div className="spinner small" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet size={18} />
                Connect Wallet
              </>
            )}
          </button>
        </div>
      )}


      <style>{`
        .reown-appkit-connect {
          width: 100%;
        }

        .button-container {
          display: flex;
          justify-content: center;
          width: 100%;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 12px;
        }

        .connected-status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          background: linear-gradient(145deg, #f0f9ff, #e0f2fe);
          border: 2px solid #3b82f6;
          border-radius: 12px;
          margin-bottom: 12px;
          min-height: 80px;
        }

        .connection-info {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .connection-icon {
          color: #3b82f6;
          flex-shrink: 0;
        }

        .connection-details {
          flex: 1;
        }

        .connection-label {
          font-weight: 600;
          color: #1e40af;
          font-size: 14px;
          margin-bottom: 2px;
        }

        .connection-address {
          font-family: monospace;
          color: #6b7280;
          font-size: 13px;
          margin-bottom: 4px;
        }

        .network-info {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
        }

        .network-name {
          color: #059669;
          font-weight: 500;
        }

        .network-symbol {
          color: #6b7280;
        }

        .connection-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .account-btn {
          background: #f3f4f6;
          color: #6b7280;
          border: none;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .account-btn:hover {
          background: #e5e7eb;
          color: #374151;
          transform: translateY(-1px);
        }

        .disconnect-btn {
          background: #ef4444;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .disconnect-btn:hover {
          background: #dc2626;
          transform: translateY(-1px);
        }

        .reown-btn {
          background: linear-gradient(145deg, #00ff88, #00cc6a);
          color: #000;
          border: none;
          border-radius: 8px;
          padding: 12px 24px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 20px;
          transition: all 0.3s ease;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .reown-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          background: linear-gradient(145deg, #00cc6a, #00b359);
        }

        .reown-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }


        .reown-appkit-connect .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(0, 0, 0, 0.3);
          border-top: 3px solid black;
          border-radius: 50%;
          animation: reown-spin 1s linear infinite;
        }

        .reown-appkit-connect .spinner.small {
          width: 16px;
          height: 16px;
          border-width: 2px;
        }

        @keyframes reown-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};