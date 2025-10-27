// UNUSED FILE - Commented out because WalletConnect is not used, we use Reown AppKit instead
/*
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import WalletConnectProvider from '@walletconnect/web3-provider';

interface WalletConnectState {
  isConnected: boolean;
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  qrCodeUri: string | null;
  provider: ethers.BrowserProvider | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// Реальная реализация WalletConnect с официальным SDK
export const useWalletConnect = (): WalletConnectState => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrCodeUri, setQrCodeUri] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [walletConnectProvider, setWalletConnectProvider] = useState<WalletConnectProvider | null>(null);

  // Инициализация WalletConnect с официальным SDK
  const initializeWalletConnect = async () => {
    try {
      console.log('🚀 Initializing WalletConnect...');
      
      const wcProvider = new WalletConnectProvider({
        rpc: {
          97: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", // BSC Testnet
        },
        bridge: "https://bridge.walletconnect.org",
        qrcode: false, // Мы создаем свой QR код
        clientMeta: {
          description: "Vesting Dashboard - Connect your wallet to access vesting features",
          url: window.location.origin,
          icons: [window.location.origin + "/favicon.ico"],
          name: "Vesting Dashboard"
        }
      });

      // Event listeners
      wcProvider.on('display_uri', (uri: string) => {
        console.log('📱 WalletConnect URI:', uri);
        setQrCodeUri(uri);
      });

      wcProvider.on('connect', (error: Error | null, payload: any) => {
        if (error) {
          console.error('❌ WalletConnect connection error:', error);
          setError(error.message);
          setIsConnecting(false);
          return;
        }

        console.log('✅ WalletConnect connected:', payload);
        const accounts = payload.params[0].accounts;
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
          setIsConnected(true);
          setIsConnecting(false);
          setError(null);
          setQrCodeUri(null);

          // Создаем ethers provider
          try {
            const ethersProvider = new ethers.BrowserProvider(wcProvider as any);
            setProvider(ethersProvider);
          } catch (err) {
            console.warn('Could not create ethers provider:', err);
          }
        }
      });

      wcProvider.on('disconnect', (error: Error | null, payload: any) => {
        console.log('🔌 WalletConnect disconnected:', payload);
        setIsConnected(false);
        setAddress(null);
        setProvider(null);
        setQrCodeUri(null);
        setIsConnecting(false);
      });

      wcProvider.on('accountsChanged', (accounts: string[]) => {
        console.log('👤 WalletConnect accounts changed:', accounts);
        if (accounts.length > 0) {
          setAddress(accounts[0]);
        } else {
          setIsConnected(false);
          setAddress(null);
          setProvider(null);
        }
      });

      setWalletConnectProvider(wcProvider);
      return wcProvider;
      
    } catch (error) {
      console.error('❌ WalletConnect initialization error:', error);
      setError('Failed to initialize WalletConnect');
      return null;
    }
  };


  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    setQrCodeUri(null);

    try {
      let wcProvider = walletConnectProvider;
      if (!wcProvider) {
        wcProvider = await initializeWalletConnect();
        if (!wcProvider) {
          throw new Error('Failed to initialize WalletConnect provider');
        }
      }

      console.log('🔄 Connecting to WalletConnect...');
      await wcProvider.enable(); // Это запустит процесс подключения и покажет QR код
      
    } catch (err: any) {
      console.error('❌ WalletConnect connection error:', err);
      setError(err.message || 'Failed to connect via WalletConnect');
      setIsConnecting(false);
      setQrCodeUri(null);
    }
  };

  const disconnect = async () => {
    console.log('🔌 Disconnecting WalletConnect...');
    
    if (walletConnectProvider) {
      try {
        await walletConnectProvider.disconnect();
      } catch (err) {
        console.error('❌ WalletConnect disconnect error:', err);
      }
    }
    
    setIsConnected(false);
    setAddress(null);
    setProvider(null);
    setQrCodeUri(null);
    setIsConnecting(false);
    setError(null);
  };

  // Инициализация при монтировании
  useEffect(() => {
    initializeWalletConnect();
  }, []);

  return {
    isConnected,
    address,
    isConnecting,
    error,
    qrCodeUri,
    provider,
    connect,
    disconnect
  };
};
*/

// Placeholder export to avoid TypeScript errors
export const useWalletConnect = () => {
  return {
    isConnected: false,
    address: null,
    isConnecting: false,
    error: null,
    qrCodeUri: null,
    provider: null,
    connect: () => {},
    disconnect: () => {}
  };
};