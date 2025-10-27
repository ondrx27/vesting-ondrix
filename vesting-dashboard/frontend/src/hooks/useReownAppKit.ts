import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// Global AppKit instance (singleton pattern like in escrow-frontend)
let appKit: any = null;

interface ReownAppKitState {
  isConnected: boolean;
  address: string | null;
  provider: ethers.BrowserProvider | null;
  isConnecting: boolean;
  error: string | null;
  chainId: number | null;
}

// Auto-add BSC network if not present in wallet (without switching)
const ensureBscNetworkExists = async (provider: any, chainId: number): Promise<void> => {
  const networkConfigs: Record<number, { chainIdHex: string; name: string; rpcUrl: string; explorerUrl: string }> = {
    56: {
      chainIdHex: '0x38',
      name: 'BNB Smart Chain Mainnet',
      rpcUrl: 'https://bsc-dataseed1.binance.org',
      explorerUrl: 'https://bscscan.com'
    },
    97: {
      chainIdHex: '0x61',
      name: 'BNB Smart Chain Testnet',
      rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      explorerUrl: 'https://testnet.bscscan.com'
    }
  };

  const config = networkConfigs[chainId];
  if (!config) {
    console.warn(`⚠️ No network config for chainId ${chainId}`);
    return;
  }

  try {
    // Just try to add the network, don't switch
    // If it already exists, this will do nothing
    console.log(`🔄 Ensuring ${config.name} exists in wallet (without switching)...`);
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: config.chainIdHex,
        chainName: config.name,
        nativeCurrency: {
          name: 'BNB',
          symbol: 'BNB',
          decimals: 18
        },
        rpcUrls: [config.rpcUrl],
        blockExplorerUrls: [config.explorerUrl]
      }]
    });
    console.log(`✅ ${config.name} is available in wallet`);
  } catch (error: any) {
    // If error code 4902, it means network doesn't exist and we tried to add it
    // Other error codes: -32002 (request pending), 4001 (user rejected)
    if (error.code === -32002) {
      console.log(`⏳ Request to add ${config.name} is pending user approval`);
    } else if (error.code === 4001) {
      console.log(`❌ User rejected adding ${config.name}`);
      throw error;
    } else {
      // Network might already exist, which is fine
      console.log(`ℹ️ ${config.name} check completed (error code: ${error.code})`);
    }
  }
};

// Safe provider creation with ENS disabled
const createSafeEvmProvider = async (provider: any, chainId: number): Promise<ethers.BrowserProvider | null> => {
  try {
    // If BSC chain (mainnet or testnet), ensure it exists in wallet (but don't switch to it)
    if (chainId === 56 || chainId === 97) {
      await ensureBscNetworkExists(provider, chainId);
    }

    const networkNames: Record<number, string> = {
      1: 'Ethereum Mainnet',
      56: 'BSC Mainnet',
      97: 'BSC Testnet',
      137: 'Polygon',
      42161: 'Arbitrum',
      8453: 'Base'
    };

    const ethersProvider = new ethers.BrowserProvider(provider, {
      name: networkNames[chainId] || 'Unknown Network',
      chainId
    });

    // Disable ENS lookups
    ethersProvider.lookupAddress = async () => null;
    ethersProvider.resolveName = async () => null;

    console.log(`✅ Created safe EVM provider for chain ${chainId}`);
    return ethersProvider;
  } catch (error) {
    console.error('❌ Error creating safe EVM provider:', error);
    return null;
  }
};

export const useReownAppKit = () => {
  const [state, setState] = useState<ReownAppKitState>({
    isConnected: false,
    address: null,
    provider: null,
    isConnecting: false,
    error: null,
    chainId: null
  });

  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

  if (!projectId) {
    throw new Error('VITE_REOWN_PROJECT_ID is required but not provided');
  }

  useEffect(() => {
    let mounted = true;

    const initializeAppKit = async () => {
      // If already initialized, just subscribe to state
      if (appKit) {
        console.log('✅ AppKit already initialized, subscribing to state');
        subscribeToState();
        return;
      }

      try {
        console.log('🔄 Initializing Reown AppKit with EthersAdapter (like escrow-frontend)');

        // Import AppKit and EthersAdapter (NOT WagmiAdapter!)
        const { createAppKit } = await import('@reown/appkit');
        const { EthersAdapter } = await import('@reown/appkit-adapter-ethers');
        const { mainnet, arbitrum, polygon, base, bscTestnet, bsc } = await import('@reown/appkit/networks');

        if (!mounted) return;

        // Create AppKit with EthersAdapter (doesn't auto-reconnect like Wagmi)
        // NO defaultNetwork - use whatever network the wallet is on
        appKit = createAppKit({
          adapters: [new EthersAdapter()],
          networks: [bsc, bscTestnet, mainnet, arbitrum, polygon, base],
          projectId,
          metadata: {
            name: 'Vesting Dashboard',
            description: 'Token Vesting Dashboard with Multi-Chain Support',
            url: window.location.origin,
            icons: ['https://reown.com/reown-logo.png']
          },
          features: {
            analytics: false,  // Disabled to avoid CORS/429 errors
            email: false,
            socials: false,
            emailShowWallets: false
          },
          themeMode: 'dark',
          themeVariables: {
            '--w3m-color-mix': '#3b82f6',
            '--w3m-color-mix-strength': 20,
            '--w3m-font-family': 'Inter, sans-serif',
            '--w3m-border-radius-master': '8px'
          }
        });

        console.log('✅ AppKit initialized successfully');

        // Create global disconnect function (like in escrow-frontend)
        (window as any).__reownDisconnect = async () => {
          try {
            await appKit.disconnect();
            console.log('✅ AppKit disconnected via global function');
          } catch (error) {
            console.warn('AppKit disconnect error:', error);
          }
        };

        // Subscribe to state changes
        subscribeToState();

      } catch (error: any) {
        console.error('❌ AppKit initialization error:', error);
        setState(prev => ({
          ...prev,
          error: `Initialization error: ${error.message}`
        }));
      }
    };

    // Subscribe to AppKit state changes
    const subscribeToState = () => {
      if (!appKit) return;

      const handleStateChange = async (newState: any) => {
        console.log('🔄 AppKit State changed:', newState);

        let address: string | undefined;
        let isConnected: boolean = false;
        let chainId: number | null = null;

        // Try multiple extraction methods (same as escrow-frontend)
        if (newState?.address) {
          address = newState.address;
          isConnected = newState.isConnected !== undefined ? newState.isConnected : !!newState.address;
          console.log('📍 Extracted from newState.address:', { address, isConnected });
        } else if (newState?.caipAddress) {
          // Extract from CAIP format: eip155:56:0x123...
          const parts = newState.caipAddress.split(':');
          address = parts[2];
          chainId = parseInt(parts[1], 10);
          isConnected = !!address;
          console.log('📍 Extracted from newState.caipAddress:', { address, chainId, isConnected });
        } else if (newState?.account?.address) {
          address = newState.account.address;
          isConnected = newState.account.isConnected !== undefined ? newState.account.isConnected : true;
          console.log('📍 Extracted from newState.account.address:', { address, isConnected });
        }

        // Try to get account via getAccount if available
        if (!address && appKit.getAccount) {
          try {
            const account = appKit.getAccount();
            if (account?.address) {
              address = account.address;
              isConnected = true;
              if (account.chainId) {
                chainId = account.chainId;
              }
              console.log('✅ Got address from getAccount():', { address, chainId });
            }
          } catch (e) {
            console.log('⚠️ getAccount() failed:', e);
          }
        }

        // If connected, create provider
        if (isConnected && address) {
          const provider = appKit.getWalletProvider?.();

          if (provider) {
            // If no chainId yet, try to get it from provider
            if (!chainId) {
              try {
                const network = await provider.request({ method: 'eth_chainId' });
                chainId = parseInt(network, 16);
                console.log('🔗 Got chainId from provider:', chainId);
              } catch (e) {
                console.warn('Could not get chainId from provider:', e);
              }
            }

            // Create ethers provider
            const ethersProvider = chainId ? await createSafeEvmProvider(provider, chainId) : null;

            setState(prev => ({
              ...prev,
              isConnected: true,
              address,
              provider: ethersProvider,
              chainId,
              isConnecting: false,
              error: null
            }));

            console.log('✅ Connected:', { address, chainId });
          } else {
            console.warn('⚠️ No provider available yet');
            setState(prev => ({
              ...prev,
              isConnected: true,
              address,
              chainId,
              isConnecting: false
            }));
          }
        } else {
          // Disconnected state
          setState(prev => ({
            ...prev,
            isConnected: false,
            address: null,
            provider: null,
            chainId: null,
            isConnecting: false
          }));
          console.log('❌ Disconnected');
        }
      };

      // Subscribe to state changes
      const unsubscribe = appKit.subscribeState(handleStateChange);

      // Check initial connection
      setTimeout(() => {
        if (appKit.getAccount) {
          const account = appKit.getAccount();
          if (account?.address) {
            console.log('🔄 Initial connection detected:', account.address);
            handleStateChange({ address: account.address, isConnected: true });
          }
        }
      }, 500);

      return unsubscribe;
    };

    initializeAppKit();

    return () => {
      mounted = false;
    };
  }, []);

  // Open connect modal
  const openConnectModal = useCallback(async () => {
    if (!appKit) {
      setState(prev => ({
        ...prev,
        error: 'AppKit не инициализирован'
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      isConnecting: true,
      error: null
    }));

    try {
      console.log('🔄 Opening AppKit modal');
      appKit.open();
      console.log('✅ Connection modal opened');

    } catch (error: any) {
      console.error('❌ Error opening connect modal:', error);

      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: error.message || 'Error opening connect modal'
      }));
    }
  }, []);

  // Open account modal
  const openAccountModal = useCallback(async () => {
    if (!appKit) {
      setState(prev => ({
        ...prev,
        error: 'AppKit не инициализирован'
      }));
      return;
    }

    try {
      await appKit.open({ view: 'Account' });
      console.log('✅ Account modal opened');
    } catch (error: any) {
      console.error('❌ Error opening account modal:', error);
    }
  }, []);

  // Switch network with auto-add support for BSC
  const switchNetwork = useCallback(async (chainId: number) => {
    if (!appKit) {
      setState(prev => ({
        ...prev,
        error: 'AppKit не инициализирован'
      }));
      return;
    }

    try {
      await appKit.switchNetwork(chainId);
      console.log('✅ Network switched to:', chainId);
    } catch (error: any) {
      console.error('❌ Network switch error:', error);

      // If error code is 4902, try to add the network
      if (error.code === 4902 && (chainId === 56 || chainId === 97)) {
        console.log('🔄 BSC network not found, attempting to add it...');
        try {
          const provider = appKit.getWalletProvider?.();
          if (provider) {
            await ensureBscNetworkExists(provider, chainId);
          }
        } catch (addError: any) {
          console.error('❌ Failed to add BSC network:', addError);
          setState(prev => ({
            ...prev,
            error: 'Failed to add BSC network'
          }));
        }
      } else {
        setState(prev => ({
          ...prev,
          error: error.message || 'Network switch error'
        }));
      }
    }
  }, []);

  // Disconnect (escrow-frontend pattern)
  const disconnect = useCallback(async () => {
    console.log('🚨 DISCONNECT FUNCTION CALLED');

    if (!appKit) {
      console.log('❌ No appKit available');
      return;
    }

    try {
      console.log('🔄 Starting disconnect process');

      // Call global disconnect function (like in escrow-frontend)
      const reownDisconnectFn = (window as any).__reownDisconnect;
      if (reownDisconnectFn) {
        console.log('🔄 Calling AppKit.disconnect()...');
        await reownDisconnectFn();
        console.log('✅ AppKit.disconnect() completed');
      }

      // Clear storage (like in escrow-frontend)
      console.log('🧹 Clearing storage...');
      localStorage.clear();
      sessionStorage.clear();
      console.log('✅ Storage cleared');

      // Update state
      setState({
        isConnected: false,
        address: null,
        provider: null,
        isConnecting: false,
        error: null,
        chainId: null
      });

      console.log('✅ Disconnect completed');

    } catch (error: any) {
      console.error('❌ Disconnect error:', error);

      // Even on error, clear storage
      localStorage.clear();
      sessionStorage.clear();

      setState({
        isConnected: false,
        address: null,
        provider: null,
        isConnecting: false,
        error: null,
        chainId: null
      });
    }
  }, []);

  // Get network info
  const getNetworkInfo = useCallback((chainId: number) => {
    const networks: Record<number, { name: string; symbol: string; explorer: string }> = {
      1: { name: 'Ethereum', symbol: 'ETH', explorer: 'https://etherscan.io' },
      56: { name: 'BSC Mainnet', symbol: 'BNB', explorer: 'https://bscscan.com' },
      97: { name: 'BSC Testnet', symbol: 'tBNB', explorer: 'https://testnet.bscscan.com' },
      137: { name: 'Polygon', symbol: 'MATIC', explorer: 'https://polygonscan.com' },
      42161: { name: 'Arbitrum', symbol: 'ETH', explorer: 'https://arbiscan.io' },
      8453: { name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org' }
    };

    return networks[chainId] || { name: 'Unknown', symbol: '?', explorer: '' };
  }, []);

  return {
    ...state,
    openConnectModal,
    openAccountModal,
    switchNetwork,
    disconnect,
    getNetworkInfo,
    isAppKitReady: !!appKit
  };
};
