import React from 'react';
import { useWallet } from '../contexts/WalletContext';
import type { SupportedChain } from '../contexts/WalletContext';

const chains: Array<{ id: SupportedChain; name: string }> = [
  { id: 'bnb', name: 'BNB Smart Chain' },
  { id: 'solana', name: 'Solana' }
];

export const ChainSelector: React.FC = () => {
  const { chain, switchChain, isConnected } = useWallet();

  const handleChainSwitch = (chainId: SupportedChain) => {
    if (chainId !== chain) {
      if (isConnected) {
        const confirm = window.confirm(
          'Switching chains will disconnect your current wallet. Continue?'
        );
        if (!confirm) return;
      }
      switchChain(chainId);
    }
  };

  return (
    <div className="chain-selector">
      {chains.map((chainOption) => (
        <button
          key={chainOption.id}
          className={`chain-btn ${chain === chainOption.id ? 'active' : ''}`}
          onClick={() => handleChainSwitch(chainOption.id)}
          disabled={isConnected && chain === chainOption.id}
        >
          {chainOption.name}
        </button>
      ))}
    </div>
  );
};