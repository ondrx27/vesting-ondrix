import React, { useState, useEffect, useMemo } from 'react';
import { WalletProvider } from './contexts/WalletContext';
import { Header } from './components/Header';
import { ChainSelector } from './components/ChainSelector';
import { WalletConnection } from './components/WalletConnection';
import { VestingDashboard } from './components/VestingDashboard';
import { LoadingSpinner } from './components/LoadingSpinnet';
import { ErrorMessage } from './components/ErrorMessage';

import { AutoDistributionDashboard } from './components/AutoDistributionDashboard';

import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

import '@solana/wallet-adapter-react-ui/styles.css';
import './App.css';

function getSolanaWallets() {
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ];
}

const SolanaProviderWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => getSolanaWallets(), []);

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

function App() {
  return (
    <SolanaProviderWrapper>
      <WalletProvider>
        <div className="app">
          <div className="container">
            <Header />
            <ChainSelector />
            <WalletConnection />
            
            {/* AutoDistributionDashboard теперь сам проверяет права доступа */}
            <AutoDistributionDashboard />
            
            <VestingDashboard />
          </div>
        </div>
      </WalletProvider>
    </SolanaProviderWrapper>
  );
}

export default App;