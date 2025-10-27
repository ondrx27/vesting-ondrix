import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface WalletDetectionInfo {
  hasMetaMask: boolean;
  hasPhantom: boolean;
  multipleProviders: boolean;
  recommendedAction: string;
  details: any;
}

export const WalletTroubleshooting: React.FC = () => {
  const [detection, setDetection] = useState<WalletDetectionInfo | null>(null);

  const detectWallets = () => {
    if (typeof window === 'undefined') return null;

    const hasWindowEthereumProviders = !!window.ethereum?.providers;
    const providersCount = window.ethereum?.providers?.length || 0;
    const hasMetaMaskProvider = window.ethereum?.providers?.some((p: any) => p.isMetaMask && !p.isPhantom);
    const hasPhantomProvider = !!window.phantom?.solana || !!window.solana?.isPhantom;
    const ethereumIsMetaMask = !!window.ethereum?.isMetaMask && !window.ethereum?.isPhantom;
    const ethereumIsPhantom = !!window.ethereum?.isPhantom;

    let hasMetaMask = false;
    let recommendedAction = '';

    if (hasWindowEthereumProviders) {
      hasMetaMask = hasMetaMaskProvider;
      if (hasMetaMask) {
        recommendedAction = 'Multiple wallets detected. MetaMask properly isolated.';
      } else {
        recommendedAction = 'Multiple wallets detected, but MetaMask not found among providers.';
      }
    } else if (ethereumIsMetaMask) {
      hasMetaMask = true;
      recommendedAction = 'MetaMask detected as single provider.';
    } else if (ethereumIsPhantom) {
      hasMetaMask = false;
      recommendedAction = 'Only Phantom detected. Please install MetaMask for BNB features.';
    } else {
      hasMetaMask = false;
      recommendedAction = 'No wallets detected. Please install MetaMask and/or Phantom.';
    }

    return {
      hasMetaMask,
      hasPhantom: hasPhantomProvider,
      multipleProviders: hasWindowEthereumProviders && providersCount > 1,
      recommendedAction,
      details: {
        providersCount,
        hasWindowEthereumProviders,
        hasMetaMaskProvider,
        hasPhantomProvider,
        ethereumIsMetaMask,
        ethereumIsPhantom,
        phantomSolanaExists: !!window.phantom?.solana,
        solanaIsPhantom: !!window.solana?.isPhantom
      }
    };
  };

  useEffect(() => {
    const info = detectWallets();
    setDetection(info);
  }, []);

  const handleRefresh = () => {
    const info = detectWallets();
    setDetection(info);
  };

  if (!detection) return null;

  return (
    <div className="wallet-troubleshooting">
      <div className="troubleshooting-header">
        <AlertTriangle size={20} />
        <h3>Wallet Detection & Troubleshooting</h3>
        <button onClick={handleRefresh} className="refresh-btn" title="Refresh detection">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="detection-status">
        <div className={`status-item ${detection.hasMetaMask ? 'success' : 'error'}`}>
          {detection.hasMetaMask ? <CheckCircle size={16} /> : <XCircle size={16} />}
          <span>MetaMask: {detection.hasMetaMask ? 'Detected' : 'Not Found'}</span>
        </div>
        
        <div className={`status-item ${detection.hasPhantom ? 'success' : 'warning'}`}>
          {detection.hasPhantom ? <CheckCircle size={16} /> : <XCircle size={16} />}
          <span>Phantom: {detection.hasPhantom ? 'Detected' : 'Not Found'}</span>
        </div>

        {detection.multipleProviders && (
          <div className="status-item info">
            <Info size={16} />
            <span>Multiple Providers: {detection.details.providersCount} detected</span>
          </div>
        )}
      </div>

      <div className="recommendation">
        <h4>Status:</h4>
        <p>{detection.recommendedAction}</p>
      </div>

      {/* Troubleshooting Steps */}
      <div className="troubleshooting-steps">
        <h4>Common Issues & Solutions:</h4>
        
        {!detection.hasMetaMask && (
          <div className="issue-solution">
            <h5>🦊 MetaMask Not Detected</h5>
            <ol>
              <li>Install MetaMask extension from <a href="https://metamask.io" target="_blank" rel="noopener noreferrer">metamask.io</a></li>
              <li>Refresh this page after installation</li>
              <li>Make sure MetaMask is enabled in your browser extensions</li>
            </ol>
          </div>
        )}

        {detection.hasPhantom && !detection.multipleProviders && (
          <div className="issue-solution">
            <h5>👻 Only Phantom Detected</h5>
            <p>For BNB Smart Chain features, you need MetaMask. Phantom is great for Solana but doesn't support BSC.</p>
            <ol>
              <li>Install MetaMask alongside Phantom</li>
              <li>Use MetaMask for BNB/BSC transactions</li>
              <li>Use Phantom for Solana transactions</li>
            </ol>
          </div>
        )}

        {detection.multipleProviders && detection.hasMetaMask && (
          <div className="issue-solution success">
            <h5>✅ Multiple Wallets Properly Configured</h5>
            <p>Great! You have both wallets installed and properly isolated.</p>
            <ul>
              <li>MetaMask will be used for BNB Smart Chain</li>
              <li>Phantom will be used for Solana</li>
              <li>No conflicts detected</li>
            </ul>
          </div>
        )}

        {detection.details.ethereumIsPhantom && (
          <div className="issue-solution warning">
            <h5>⚠️ Phantom Overriding Ethereum Provider</h5>
            <p>Phantom is taking over the main ethereum provider. This might cause issues.</p>
            <ol>
              <li>Try disabling Phantom temporarily for BNB transactions</li>
              <li>Or use MetaMask in a different browser</li>
              <li>Consider using different browser profiles for different wallets</li>
            </ol>
          </div>
        )}
      </div>

      {/* Debug Information */}
      <details className="debug-info">
        <summary>🔍 Debug Information (for developers)</summary>
        <pre>{JSON.stringify(detection.details, null, 2)}</pre>
      </details>

      {/* Manual Instructions */}
      <div className="manual-instructions">
        <h4>Manual Wallet Selection:</h4>
        <p>If automatic detection fails, try these browser console commands:</p>
        
        <div className="console-commands">
          <h5>Force MetaMask Connection:</h5>
          <code>
            {`// In browser console:
if (window.ethereum?.providers) {
  const metamask = window.ethereum.providers.find(p => p.isMetaMask && !p.isPhantom);
  if (metamask) {
    metamask.request({method: 'eth_requestAccounts'});
  }
}`}
          </code>
          
          <h5>Check Available Providers:</h5>
          <code>
            {`// In browser console:
console.log('Providers:', window.ethereum?.providers);
console.log('Phantom:', window.phantom?.solana);
console.log('Solana:', window.solana);`}
          </code>
        </div>
      </div>
    </div>
  );
};