// src/components/WalletConnection.tsx - Обновленная версия с Reown AppKit
import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { ReownAppKitConnect } from './ReownAppkitConnect';
import { Wallet, LogOut, AlertTriangle } from 'lucide-react';
import { WalletMultiButton, WalletDisconnectButton } from '@solana/wallet-adapter-react-ui';
import { ethers } from 'ethers';

export const WalletConnection: React.FC = () => {
  const [localError, setLocalError] = useState<string | null>(null);
  const { 
    isConnected, 
    address, 
    chain, 
    isConnecting, 
    error, 
    connect, 
    disconnect,
    solanaWallet,
    reownAddress,
    reownProvider,
    setReownConnection,
    disconnectReown
  } = useWallet();

  // Clear local error when global error changes or when connecting
  useEffect(() => {
    if (error || isConnecting) {
      setLocalError(null);
    }
  }, [error, isConnecting]);

  const handleReownConnect = (reownAddr: string, reownProv: ethers.BrowserProvider) => {
    console.log('✅ Reown AppKit connected:', reownAddr);
    setReownConnection(reownAddr, reownProv);
    setLocalError(null);
  };

  const handleReownDisconnect = async () => {
    console.log('🔌 handleReownDisconnect called - disconnecting Reown');
    
    try {
      // Сначала пытаемся отключиться через AppKit API
      const reownDisconnect = (window as any).__reownDisconnect;
      if (reownDisconnect) {
        console.log('🔄 Calling AppKit disconnect...');
        await reownDisconnect();
        console.log('✅ AppKit disconnect completed');
      } else {
        console.log('⚠️ AppKit disconnect function not found');
      }
      
      // Затем очищаем через WalletContext
      await disconnectReown();
      
    } catch (error) {
      console.error('❌ Error disconnecting Reown:', error);
      
      // Даже при ошибке пытаемся очистить состояние
      try {
        await disconnectReown();
      } catch (fallbackError) {
        console.error('❌ Fallback disconnect also failed:', fallbackError);
      }
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getWalletName = () => {
    if (chain === 'bnb') {
      if (reownAddress) {
        return 'Reown Wallet';
      }
      return 'MetaMask';
    } else {
      if (solanaWallet?.wallet?.adapter?.name) {
        return solanaWallet.wallet.adapter.name;
      }
      return 'Solana Wallet';
    }
  };

  const isMetaMaskInstalled = () => {
    if (typeof window === 'undefined') return false;
    
    // Check for MetaMask provider
    if (window.ethereum?.providers?.length) {
      return window.ethereum.providers.some((provider: any) => provider.isMetaMask && !provider.isPhantom);
    }
    
    if (window.ethereum?.isMetaMask && !window.ethereum?.isPhantom) {
      return true;
    }
    
    if (window.ethereum?._metamask) {
      return true;
    }
    
    if ((window as any).metamask) {
      return true;
    }
    
    return false;
  };

  const getChainName = () => {
    return chain === 'bnb' ? 'BNB Smart Chain' : 'Solana';
  };

  // Определяем активное подключение - теперь все через WalletContext
  const activeAddress = address;
  const activeConnection = isConnected;

  if (activeConnection && activeAddress) {
    const displayName = getWalletName();
    // Если BNB chain и есть reownAddress - значит это Reown подключение
    const isReownConnection = chain === 'bnb' && !!reownAddress;
    
    return (
      <div className="wallet-connected">
        <div className="wallet-info">
          <div className="wallet-status">
            <Wallet size={20} />
            <span>Connected to {displayName}</span>
          </div>
          <div className="wallet-address">{formatAddress(activeAddress)}</div>
          <div className="wallet-chain">{getChainName()}</div>
        </div>
        
        {chain === 'bnb' ? (
          <button 
            className="disconnect-btn"
            onClick={isReownConnection ? handleReownDisconnect : disconnect}
            title="Disconnect wallet"
          >
            <LogOut size={18} />
          </button>
        ) : (
          <WalletDisconnectButton 
            style={{ 
              background: '#ff4444',
              border: 'none',
              color: 'white',
              padding: '10px 14px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }} 
          />
        )}


      </div>
    );
  }

  return (
    <div className="wallet-connection">
      <div className="wallet-info-section">
        <h3>Connect Your Wallet</h3>
        <p>
          Connect your wallet to access {getChainName()} features and view your vesting information.
        </p>
        {!activeConnection && (
          <div className="wallet-note">
            Basic vesting information is available without connecting a wallet.
          </div>
        )}
      </div>
      
      {(error || localError) && (
        <div className="error-message">
          <AlertTriangle size={18} />
          <span>{error || localError}</span>
        </div>
      )}

      {chain === 'bnb' ? (
        <div className="bnb-wallet-section">
          {/* Всегда показываем Reown AppKit для BNB */}
          <div className="reown-section">
            <ReownAppKitConnect 
              onConnect={handleReownConnect}
              onDisconnect={handleReownDisconnect}
            />
          </div>

        </div>
      ) : (
        <div className="solana-wallet-section" style={{ marginTop: '20px' }}>
          <WalletMultiButton 
            style={{ 
              background: 'linear-gradient(145deg, #00ff88, #00cc6a)',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              width: '100%',
              marginBottom: '20px',
              transition: 'all 0.3s ease',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          />
          
          {isConnecting && (
            <div className="connecting-overlay">
              <div className="spinner" />
              <span>Connecting to wallet...</span>
              <p>Please check your wallet and approve the connection request.</p>
            </div>
          )}
        </div>
      )}
      



    </div>
  );
};