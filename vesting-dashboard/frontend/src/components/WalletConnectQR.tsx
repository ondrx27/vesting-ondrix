import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { QrCode, Copy, RefreshCw, X, Smartphone, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode-generator';

interface WalletConnectQRProps {
  onConnect: (address: string, provider: ethers.BrowserProvider) => void;
  onDisconnect: () => void;
}

export const WalletConnectQR: React.FC<WalletConnectQRProps> = ({
  onConnect,
  onDisconnect
}) => {
  const [showModal, setShowModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionUri, setConnectionUri] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connector, setConnector] = useState<any>(null);

  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

  useEffect(() => {
    // Инициализируем простой WalletConnect fallback
    const initSimpleWalletConnect = () => {
      try {
        // Создаем простой connector объект для fallback
        const simpleConnector = {
          connect: async () => {
            const uri = generateWalletConnectUri();
            return uri;
          },
          disconnect: async () => {
            console.log('Disconnected');
          }
        };
        setConnector(simpleConnector);
      } catch (err) {
        console.log('WalletConnect инициализация не удалась');
      }
    };

    initSimpleWalletConnect();
  }, []);

  const generateWalletConnectUri = () => {
    // Генерируем простой WalletConnect URI для демонстрации
    const sessionId = Math.random().toString(36).substring(7);
    const bridge = encodeURIComponent('https://bridge.walletconnect.org');
    const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    
    return `wc:${sessionId}@1?bridge=${bridge}&key=${key}`;
  };

  const generateQRCode = (uri: string) => {
    const qr = QRCode(0, 'M');
    qr.addData(uri);
    qr.make();
    return qr.createDataURL(12, 4); // Увеличенный размер: cellSize=12, margin=4
  };

  const handleConnect = async () => {
    if (!connector) {
      setError('WalletConnect не инициализирован');
      return;
    }

    setError(null);
    setIsConnecting(true);
    
    try {
      const uri = await connector.connect();
      setConnectionUri(uri);
      const qrUrl = generateQRCode(uri);
      setQrCodeUrl(qrUrl);
      setShowModal(true);
      
      // Примечание: В реальной реализации здесь была бы логика ожидания подключения
      // Для демонстрации показываем QR код
      
    } catch (err: any) {
      console.error('WalletConnect connection error:', err);
      setError(err.message || 'Ошибка подключения WalletConnect');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (connector) {
      try {
        await connector.disconnect();
        onDisconnect();
      } catch (err) {
        console.error('WalletConnect disconnect error:', err);
      }
    }
    setShowModal(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(connectionUri);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleRefresh = () => {
    setShowModal(false);
    setTimeout(() => {
      handleConnect();
    }, 500);
  };

  return (
    <>
      <div className="walletconnect-qr">
        <button 
          className="connect-btn walletconnect-btn"
          onClick={handleConnect}
          disabled={isConnecting || !connector}
        >
          {isConnecting ? (
            <>
              <div className="spinner small" />
              Подключение...
            </>
          ) : (
            <>
              <QrCode size={18} />
              WalletConnect QR
            </>
          )}
        </button>

        {!connector && (
          <div className="warning-message">
            <AlertTriangle size={16} />
            <span>Загрузка WalletConnect...</span>
          </div>
        )}

        {error && (
          <div className="error-message">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Модальное окно */}
      {showModal && (
        <div className="walletconnect-modal-overlay">
          <div className="walletconnect-modal">
            <div className="modal-header">
              <h3>Подключение WalletConnect</h3>
              <button 
                className="close-btn"
                onClick={() => setShowModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-content">
              {qrCodeUrl ? (
                <>
                  <div className="qr-section">
                    <div className="qr-code-container">
                      <img 
                        src={qrCodeUrl} 
                        alt="WalletConnect QR Code"
                        className="qr-code-image"
                      />
                    </div>
                    
                    <div className="qr-instructions">
                      <h4>Сканируйте QR-код кошельком</h4>
                      <p>1. Откройте ваш мобильный кошелек (MetaMask, Trust Wallet, и др.)</p>
                      <p>2. Найдите функцию сканирования QR-кода</p>
                      <p>3. Отсканируйте этот QR-код</p>
                      <p>4. Подтвердите подключение в кошельке</p>
                    </div>
                  </div>

                  <div className="modal-actions">
                    <button 
                      className="action-btn copy-btn"
                      onClick={copyToClipboard}
                      title="Копировать ссылку"
                    >
                      <Copy size={16} />
                      Копировать ссылку
                    </button>
                    
                    <button 
                      className="action-btn refresh-btn"
                      onClick={handleRefresh}
                      title="Обновить QR код"
                    >
                      <RefreshCw size={16} />
                      Обновить
                    </button>
                    
                    <a 
                      href={connectionUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-btn mobile-btn"
                    >
                      <Smartphone size={16} />
                      Открыть в кошельке
                    </a>
                  </div>
                </>
              ) : (
                <div className="loading-section">
                  <div className="spinner" />
                  <p>Генерация QR-кода...</p>
                </div>
              )}

              {isConnecting && (
                <div className="connecting-status">
                  <div className="pulse-dot" />
                  <span>Ожидание подключения...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .walletconnect-qr {
          width: 100%;
        }

        .walletconnect-btn {
          background: linear-gradient(145deg, #3b82f6, #1d4ed8);
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          justify-content: center;
          transition: all 0.3s ease;
        }

        .walletconnect-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }

        .walletconnect-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .warning-message, .error-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 14px;
          margin-top: 8px;
        }

        .warning-message {
          background: rgba(251, 191, 36, 0.1);
          color: #f59e0b;
          border: 1px solid rgba(251, 191, 36, 0.3);
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .walletconnect-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .walletconnect-modal {
          background: white;
          border-radius: 16px;
          width: 95%;
          max-width: 600px;
          max-height: 95vh;
          overflow: auto;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid #e5e7eb;
        }

        .modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #111827;
        }

        .close-btn {
          background: none;
          border: none;
          color: #6b7280;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .close-btn:hover {
          background: #f3f4f6;
          color: #111827;
        }

        .modal-content {
          padding: 24px;
        }

        .qr-section {
          text-align: center;
        }

        .qr-code-container {
          display: flex;
          justify-content: center;
          margin-bottom: 24px;
        }

        .qr-code-image {
          border-radius: 12px;
          border: 2px solid #e5e7eb;
          background: white;
          padding: 20px;
          width: 280px;
          height: 280px;
          object-fit: contain;
          max-width: 90vw;
          max-height: 280px;
        }

        @media (max-width: 480px) {
          .qr-code-image {
            width: 250px;
            height: 250px;
            padding: 16px;
          }
          
          .walletconnect-modal {
            width: 98%;
            max-width: 400px;
          }
          
          .modal-content {
            padding: 20px;
          }
        }

        .qr-instructions {
          text-align: left;
          margin-bottom: 24px;
        }

        .qr-instructions h4 {
          margin: 0 0 16px 0;
          font-size: 16px;
          font-weight: 600;
          color: #111827;
          text-align: center;
        }

        .qr-instructions p {
          margin: 8px 0;
          color: #6b7280;
          font-size: 14px;
        }

        .modal-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 16px;
        }

        .action-btn {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          color: #374151;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-decoration: none;
          transition: all 0.2s;
        }

        .action-btn:hover {
          background: #f3f4f6;
          border-color: #d1d5db;
        }

        .mobile-btn {
          grid-column: 1 / -1;
          background: #10b981;
          color: white;
          border-color: #10b981;
        }

        .mobile-btn:hover {
          background: #059669;
        }

        .loading-section {
          text-align: center;
          padding: 40px 20px;
        }

        .loading-section p {
          margin-top: 16px;
          color: #6b7280;
        }

        .connecting-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 16px;
          background: #f0f9ff;
          border-radius: 8px;
          margin-top: 16px;
        }

        .pulse-dot {
          width: 12px;
          height: 12px;
          background: #3b82f6;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #e5e7eb;
          border-top: 4px solid #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .spinner.small {
          width: 16px;
          height: 16px;
          border-width: 2px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};