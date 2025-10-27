import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react';
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';

import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

export type SupportedChain = 'bnb' | 'solana';

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chain: SupportedChain;
  isConnecting: boolean;
  error: string | null;

  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;

  solanaConnection: Connection | null;
  solanaPublicKey: PublicKey | null;
  solanaWallet: any;

  // Reown integration
  reownAddress: string | null;
  reownProvider: ethers.BrowserProvider | null;
  setReownConnection: (address: string | null, provider: ethers.BrowserProvider | null) => void;
  disconnectReown: () => Promise<void>;

  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (chain: SupportedChain) => void;
}

const WalletContext = createContext<WalletState | null>(null);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: ReactNode;
}

// MetaMask support removed - using only Reown/WalletConnect for BNB chain

function getPhantomProvider() {
  if (typeof window === 'undefined') return null;

  if (window.phantom?.solana?.isPhantom) {
    return window.phantom.solana;
  }

  if (window.solana?.isPhantom) {
    return window.solana;
  }

  return null;
}

function getSolanaWallets() {
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ];
}

const SolanaWalletProviderWrapper: React.FC<{ children: ReactNode; enabled: boolean }> = ({ children, enabled }) => {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => getSolanaWallets(), []);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

const WalletProviderInner: React.FC<WalletProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chain, setChain] = useState<SupportedChain>('bnb');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);

  // Reown state
  const [reownAddress, setReownAddress] = useState<string | null>(null);
  const [reownProvider, setReownProvider] = useState<ethers.BrowserProvider | null>(null);

  // Debug: log when address changes
  React.useEffect(() => {
    console.log('🔍 WalletContext address changed:', {
      address,
      isConnected,
      reownAddress,
      source: address === reownAddress ? 'reown' : address ? 'other' : 'none'
    });
  }, [address, isConnected, reownAddress]);

  const [solanaConnection, setSolanaConnection] = useState<Connection | null>(null);

  let solanaWallet: any = null;
  try {
    if (chain === 'solana') {
      solanaWallet = useSolanaWallet();
    }
  } catch (error) {
    console.warn('Solana wallet not available:', error);
  }

  useEffect(() => {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    setSolanaConnection(connection);
  }, []);

  useEffect(() => {
    if (chain === 'solana' && solanaWallet) {
      if (solanaWallet.connected && solanaWallet.publicKey) {
        setIsConnected(true);
        setAddress(solanaWallet.publicKey.toString());
        setError(null);
      } else {
        if (isConnected) {
          setIsConnected(false);
          setAddress(null);
        }
      }
    }
  }, [solanaWallet?.connected, solanaWallet?.publicKey, chain]);

  useEffect(() => {
    if (chain === 'solana' && solanaWallet) {
      setIsConnecting(solanaWallet.connecting);
    }
  }, [solanaWallet?.connecting, chain]);

  const connectBNB = async () => {
    // BNB connections now handled through Reown only
    throw new Error('BNB connections are now handled through WalletConnect/Reown. Use the WalletConnect button.');
  };

  const connectSolana = async () => {
    if (chain !== 'solana') {
      throw new Error('Switch to Solana chain first');
    }

    if (!solanaWallet) {
      throw new Error('Solana wallet provider not available');
    }

    console.log('👻 Connecting to Solana wallet...');
    await solanaWallet.connect();
  };

  const connect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      if (chain === 'bnb') {
        await connectBNB();
      } else if (chain === 'solana') {
        await connectSolana();
      }
    } catch (err: any) {
      setError(err.message);
      console.error('Connection error:', err);
    } finally {
      if (chain === 'bnb') {
        setIsConnecting(false);
      }
    }
  };

  const disconnect = async () => {
    setIsConnected(false);
    setAddress(null);
    setError(null);

    if (chain === 'bnb') {
      setProvider(null);
      setSigner(null);
      // Also clear Reown state
      setReownAddress(null);
      setReownProvider(null);
    } else if (chain === 'solana' && solanaWallet) {
      try {
        await solanaWallet.disconnect();
      } catch (error) {
        console.warn('Error disconnecting Solana wallet:', error);
      }
    }
  };

  const switchChain = (newChain: SupportedChain) => {
    if (newChain !== chain) {
      console.log(`🔄 Switching from ${chain} to ${newChain}`);
      disconnect();
      setChain(newChain);
    }
  };

  // MetaMask event listeners removed - using only Reown/WalletConnect for BNB

  // MetaMask detection removed - using only Reown/WalletConnect for BNB

  // Function to handle Reown connection
  const setReownConnection = (reownAddr: string | null, reownProv: ethers.BrowserProvider | null) => {
    console.log('🔗 WalletContext setReownConnection called:', {
      reownAddr,
      hasProvider: !!reownProv,
      currentChain: chain,
      currentAddress: address
    });

    setReownAddress(reownAddr);
    setReownProvider(reownProv);

    // If BNB chain and Reown is connecting, prioritize it
    if (chain === 'bnb' && reownAddr && reownProv) {
      console.log('✅ Setting Reown as active connection for BNB');

      setIsConnected(true);
      setAddress(reownAddr);
      setProvider(reownProv);

      // Don't try to get signer immediately - let it be lazy loaded when needed
      // This prevents the -32002 error from multiple pending requests
      console.log('🔄 Reown provider set, signer will be obtained when needed');
      setSigner(null);
    } else if (!reownAddr) {
      // Reown disconnected - reset if it was the active connection
      if (reownAddress === address) {
        setIsConnected(false);
        setAddress(null);
        setProvider(null);
        setSigner(null);
      }
    }
  };

  // Function to disconnect Reown completely
  const disconnectReown = async () => {
    console.log('🔌 WalletContext disconnectReown called');

    try {
      // СНАЧАЛА отключаемся через AppKit API
      try {
        const reownDisconnectFn = (window as any).__reownDisconnect;
        if (reownDisconnectFn) {
          console.log('🔄 Calling AppKit.disconnect()...');
          await reownDisconnectFn();
          console.log('✅ AppKit.disconnect() completed');
        } else {
          console.log('⚠️ AppKit disconnect function not available');
        }
      } catch (appKitError) {
        console.warn('⚠️ AppKit disconnect failed:', appKitError);
      }

      // Затем очищаем хранилище
      console.log('📋 All localStorage keys before clearing:', Object.keys(localStorage));

      // Clear ALL storage types
      console.log('🧹 Clearing ALL storage types...');

      // 1. Clear localStorage and sessionStorage
      localStorage.clear();
      sessionStorage.clear();

      // 2. Clear IndexedDB databases (WalletConnect может использовать)
      try {
        const databases = await indexedDB.databases();
        console.log('🗄️ Found IndexedDB databases:', databases.map(db => db.name));

        for (const db of databases) {
          if (db.name && (db.name.includes('walletconnect') || db.name.includes('reown') || db.name.includes('w3m'))) {
            console.log(`🗑️ Deleting database: ${db.name}`);
            const deleteReq = indexedDB.deleteDatabase(db.name);
            await new Promise((resolve, reject) => {
              deleteReq.onsuccess = () => resolve(void 0);
              deleteReq.onerror = () => reject(deleteReq.error);
            });
          }
        }
      } catch (idbError) {
        console.warn('⚠️ IndexedDB cleanup failed:', idbError);
      }

      // 3. Clear any cookies related to WalletConnect/Reown
      try {
        document.cookie.split(";").forEach(function(c) {
          const cookieName = c.replace(/^ +/, "").replace(/=.*/, "");
          if (cookieName.includes('walletconnect') || cookieName.includes('reown') || cookieName.includes('w3m')) {
            document.cookie = cookieName + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          }
        });
      } catch (cookieError) {
        console.warn('⚠️ Cookie cleanup failed:', cookieError);
      }

      // 4. Clear Service Workers (могут кэшировать состояние)
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          console.log('🔧 Found Service Workers:', registrations.length);
          for (const registration of registrations) {
            if (registration.scope.includes('reown') || registration.scope.includes('walletconnect')) {
              console.log('🗑️ Unregistering Service Worker:', registration.scope);
              await registration.unregister();
            }
          }
        }
      } catch (swError) {
        console.warn('⚠️ Service Worker cleanup failed:', swError);
      }

      // 5. Clear Cache API
      try {
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          console.log('💾 Found caches:', cacheNames);
          for (const cacheName of cacheNames) {
            if (cacheName.includes('reown') || cacheName.includes('walletconnect') || cacheName.includes('w3m')) {
              console.log('🗑️ Deleting cache:', cacheName);
              await caches.delete(cacheName);
            }
          }
        }
      } catch (cacheError) {
        console.warn('⚠️ Cache API cleanup failed:', cacheError);
      }

      console.log('🧹 Cleared ALL storage types');

      // Устанавливаем флаг что пользователь отключился намеренно
      localStorage.setItem('reown-manually-disconnected', 'true');
      console.log('🏴 Set manual disconnect flag');

      // Clear state
      setReownAddress(null);
      setReownProvider(null);
      setIsConnected(false);
      setAddress(null);
      setProvider(null);
      setSigner(null);

      console.log('✅ Reown completely disconnected');

    } catch (error) {
      console.error('❌ Error disconnecting Reown:', error);
    }
  };

  const value: WalletState = {
    isConnected,
    address,
    chain,
    isConnecting,
    error,
    provider,
    signer,
    solanaConnection,
    solanaPublicKey: solanaWallet?.publicKey || null,
    solanaWallet,
    reownAddress,
    reownProvider,
    setReownConnection,
    disconnectReown,
    connect,
    disconnect,
    switchChain,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  return (
    <SolanaWalletProviderWrapper enabled={true}>
      <WalletProviderInner>
        {children}
      </WalletProviderInner>
    </SolanaWalletProviderWrapper>
  );
};

declare global {
  interface Window {
    ethereum?: any;
    solana?: any;
    phantom?: {
      solana?: any;
    };
    metamask?: any;
  }
}