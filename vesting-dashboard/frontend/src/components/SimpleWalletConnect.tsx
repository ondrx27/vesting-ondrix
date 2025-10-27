import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { AlertTriangle, ExternalLink, Smartphone, QrCode, RefreshCw, Copy } from 'lucide-react';
import QRCode from 'qrcode-generator';

interface SimpleWalletConnectProps {
  onConnect: (address: string, provider: ethers.BrowserProvider) => void;
  onDisconnect: () => void;
}

export const SimpleWalletConnect: React.FC<SimpleWalletConnectProps> = ({
  onConnect,
  onDisconnect
}) => {
  const [showQR, setShowQR] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionUri, setConnectionUri] = useState<string>('');

  const generateConnectionUri = () => {
    const origin = window.location.origin;
    const chainId = '97'; // BSC Testnet
    const uri = `https://metamask.app.link/dapp/${window.location.host}?chainId=${chainId}`;
    return uri;
  };

  const generateQRCode = (uri: string) => {
    const qr = QRCode(0, 'M');
    qr.addData(uri);
    qr.make();
    return qr.createDataURL(8, 2);
  };

  const handleConnectWithQR = () => {
    setError(null);
    setIsConnecting(true);
    
    try {
      const uri = generateConnectionUri();
      const qrUrl = generateQRCode(uri);
      
      setConnectionUri(uri);
      setQrCodeUrl(qrUrl);
      setShowQR(true);
      
      // Симуляция ожидания подключения
      setTimeout(() => {
        setIsConnecting(false);
      }, 2000);
      
    } catch (err: any) {
      setError('Failed to generate connection QR code');
      setIsConnecting(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(connectionUri);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="simple-walletconnect">
      {!showQR ? (
        <div className="walletconnect-intro">
          <div className="fallback-message">
            <AlertTriangle size={20} />
            <p>MetaMask not detected on desktop.</p>
            <p>Connect using MetaMask mobile app:</p>
          </div>
          
          <div className="fallback-options">
            <button 
              className="connect-btn walletconnect-btn"
              onClick={handleConnectWithQR}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <div className="spinner small" />
                  Generating QR Code...
                </>
              ) : (
                <>
                  <QrCode size={18} />
                  Connect with QR Code
                </>
              )}
            </button>
            
            <div className="or-divider">
              <span>or</span>
            </div>
            
            <a 
              href={generateConnectionUri()}
              target="_blank" 
              rel="noopener noreferrer"
              className="mobile-connect-btn secondary"
            >
              <Smartphone size={18} />
              Open in MetaMask Mobile
              <ExternalLink size={14} />
            </a>
          </div>
          
          <div className="installation-note">
            <p>Don't have MetaMask? <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Install MetaMask</a></p>
          </div>
        </div>
      ) : (
        <div className="qr-connect-section">
          <div className="qr-header">
            <h4>Scan with MetaMask Mobile</h4>
            <button 
              className="close-btn"
              onClick={() => setShowQR(false)}
            >
              ✕
            </button>
          </div>
          
          {qrCodeUrl && (
            <div className="qr-code-container">
              <img 
                src={qrCodeUrl} 
                alt="WalletConnect QR Code"
                className="qr-code"
              />
            </div>
          )}
          
          <div className="qr-instructions">
            <p>1. Open MetaMask mobile app</p>
            <p>2. Tap the scan icon</p>
            <p>3. Scan this QR code</p>
            <p>4. Approve the connection</p>
          </div>
          
          <div className="qr-actions">
            <button 
              className="copy-btn"
              onClick={copyToClipboard}
            >
              <Copy size={16} />
              Copy Link
            </button>
            
            <button 
              className="refresh-btn"
              onClick={handleConnectWithQR}
            >
              <RefreshCw size={16} />
              Refresh QR
            </button>
          </div>
          
          {isConnecting && (
            <div className="connecting-status">
              <div className="spinner small"></div>
              <span>Waiting for connection...</span>
            </div>
          )}
          
          {error && (
            <div className="error-message">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};