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

function getMetaMaskProvider() {
  if (typeof window === 'undefined') return null;

  if (window.ethereum?.providers?.length) {
    const metamaskProvider = window.ethereum.providers.find((provider: any) => provider.isMetaMask && !provider.isPhantom);
    if (metamaskProvider) {
      return metamaskProvider;
    }
  }

  if (window.ethereum?.isMetaMask && !window.ethereum?.isPhantom) {
    return window.ethereum;
  }

  if (window.ethereum?._metamask) {
    return window.ethereum;
  }

  if ((window as any).metamask) {
    return (window as any).metamask;
  }

  return null;
}

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
    if (chain !== 'bnb') {
      throw new Error('Switch to BNB chain first');
    }

    const metamaskProvider = getMetaMaskProvider();
    
    if (!metamaskProvider) {
      throw new Error('MetaMask is not installed or not detected. Please install MetaMask extension and make sure it\'s enabled.');
    }

    console.log('🦊 Using MetaMask provider:', {
      isMetaMask: metamaskProvider.isMetaMask,
      isPhantom: metamaskProvider.isPhantom,
      hasMetamaskFlag: !!metamaskProvider._metamask
    });

    const provider = new ethers.BrowserProvider(metamaskProvider);
    
    try {
      console.log('🔗 Requesting account access...');
      await metamaskProvider.request({ method: 'eth_requestAccounts' });
      
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      console.log('✅ Connected to MetaMask:', address);
      
      try {
        console.log('🔄 Switching to BSC Testnet...');
        await metamaskProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x61' }],
        });
      } catch (switchError: any) {
        console.log('🔄 Network not found, adding BSC Testnet...');
        if (switchError.code === 4902) {
          await metamaskProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x61',
              chainName: 'BSC Testnet',
              nativeCurrency: {
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18,
              },
              rpcUrls: ['https://data-seed-prebsc-1-s1.bnbchain.org:8545'],
              blockExplorerUrls: ['https://testnet.bscscan.com'],
            }],
          });
        } else {
          throw switchError;
        }
      }

      setProvider(provider);
      setSigner(signer);
      setAddress(address);
      setIsConnected(true);
      
    } catch (error: any) {
      console.error('❌ MetaMask connection error:', error);
      if (error.code === 4001) {
        throw new Error('Connection rejected by user');
      } else if (error.code === -32002) {
        throw new Error('Connection request already pending. Please check MetaMask.');
      } else {
        throw new Error(`MetaMask connection failed: ${error.message}`);
      }
    }
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

  useEffect(() => {
    if (chain === 'bnb') {
      const metamaskProvider = getMetaMaskProvider();
      
      if (metamaskProvider) {
        const handleAccountsChanged = (accounts: string[]) => {
          console.log('🔄 MetaMask accounts changed:', accounts);
          if (accounts.length === 0) {
            disconnect();
          } else if (accounts[0] !== address) {
            setAddress(accounts[0]);
          }
        };

        const handleChainChanged = (chainId: string) => {
          console.log('🔄 MetaMask chain changed:', chainId);
          window.location.reload();
        };

        metamaskProvider.on('accountsChanged', handleAccountsChanged);
        metamaskProvider.on('chainChanged', handleChainChanged);
        
        return () => {
          metamaskProvider.removeListener('accountsChanged', handleAccountsChanged);
          metamaskProvider.removeListener('chainChanged', handleChainChanged);
        };
      }
    }
  }, [chain, address]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('🔍 Wallet detection:', {
        hasWindowEthereumProviders: !!window.ethereum?.providers,
        providersCount: window.ethereum?.providers?.length || 0,
        hasWindowEthereum: !!window.ethereum,
        ethereumIsMetaMask: !!window.ethereum?.isMetaMask,
        ethereumIsPhantom: !!window.ethereum?.isPhantom,
        hasPhantomSolana: !!window.phantom?.solana,
        hasSolana: !!window.solana,
        metamaskProvider: !!getMetaMaskProvider(),
        phantomProvider: !!getPhantomProvider()
      });
    }
  }, []);

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
  const [chain, setChain] = useState<SupportedChain>('bnb');

  return (
    <SolanaWalletProviderWrapper enabled={chain === 'solana'}>
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