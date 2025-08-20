// src/components/WalletConnection.tsx - Чистая версия без troubleshooting
import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { Wallet, LogOut, AlertTriangle } from 'lucide-react';
import { WalletMultiButton, WalletDisconnectButton } from '@solana/wallet-adapter-react-ui';

export const WalletConnection: React.FC = () => {
  const { 
    isConnected, 
    address, 
    chain, 
    isConnecting, 
    error, 
    connect, 
    disconnect,
    solanaWallet
  } = useWallet();

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getWalletName = () => {
    if (chain === 'bnb') {
      return 'MetaMask';
    } else {
      if (solanaWallet?.wallet?.adapter?.name) {
        return solanaWallet.wallet.adapter.name;
      }
      return 'Solana Wallet';
    }
  };

  const getChainName = () => {
    return chain === 'bnb' ? 'BNB Smart Chain' : 'Solana';
  };

  if (isConnected && address) {
    return (
      <div className="wallet-connected">
        <div className="wallet-info">
          <div className="wallet-status">
            <Wallet size={20} />
            <span>Connected to {getWalletName()}</span>
          </div>
          <div className="wallet-address">{formatAddress(address)}</div>
          <div className="wallet-chain">{getChainName()}</div>
        </div>
        
        {chain === 'bnb' ? (
          <button 
            className="disconnect-btn"
            onClick={disconnect}
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
        {!isConnected && (
          <div className="wallet-note">
            Basic vesting information is available without connecting a wallet.
          </div>
        )}
      </div>
      
      {error && (
        <div className="error-message">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {chain === 'bnb' ? (
        <button 
          className="connect-btn"
          onClick={connect}
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
              Connect MetaMask
            </>
          )}
        </button>
      ) : (
        <div className="solana-wallet-section">
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
      
      <div className="wallet-requirements">
        <h4>Requirements:</h4>
        <ul>
          <li>
            {chain === 'bnb' 
              ? 'MetaMask wallet extension installed'
              : 'Compatible Solana wallet (Phantom, Solflare, etc.)'
            }
          </li>
          <li>
            {chain === 'bnb' 
              ? 'Connect to BSC Testnet (will be added automatically)' 
              : 'Connect to Solana Devnet'
            }
          </li>
          <li>
            Small amount of {chain === 'bnb' ? 'BNB' : 'SOL'} for transaction fees
          </li>
        </ul>
        
        <div className="wallet-download">
          <h5>Download Wallets:</h5>
          <div className="download-links">
            {chain === 'bnb' ? (
              <a 
                href="https://metamask.io/download/" 
                target="_blank"
                rel="noopener noreferrer"
                className="download-link"
              >
                Download MetaMask →
              </a>
            ) : (
              <>
                <a 
                  href="https://phantom.app/download" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="download-link"
                >
                  Download Phantom →
                </a>
                <a 
                  href="https://solflare.com/download" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="download-link"
                >
                  Download Solflare →
                </a>
              </>
            )}
          </div>
        </div>

        {chain === 'solana' && (
          <div className="solana-info">
            <h5>Solana Wallet Support:</h5>
            <p>
              Click "Connect Solana Wallet" to see all available wallets. 
              The modal will show installed browser extensions and mobile wallet options.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};