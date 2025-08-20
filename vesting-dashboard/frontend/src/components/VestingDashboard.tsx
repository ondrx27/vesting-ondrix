// src/components/VestingDashboard.tsx
import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { VestingService } from '../services/vestingService';
import { LoadingSpinner } from './LoadingSpinnet';
import { ErrorMessage } from './ErrorMessage';
import { VestingOverview } from './VestingOverview';
import { VestingDetails } from './VestingDetails';
import { RecipientsList } from './RecipientsList';
import { ClaimInterface } from './ClaimInterface';
import type { VestingData } from '../types/vesting';
import { RefreshCw } from 'lucide-react';

export const VestingDashboard: React.FC = () => {
  const { isConnected, address, chain, provider, solanaConnection } = useWallet();
  const [vestingData, setVestingData] = useState<VestingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const vestingService = new VestingService();

  const fetchVestingData = async () => {
    try {
      setLoading(true);
      setError(null);

      let data: VestingData | null = null;

      if (chain === 'bnb') {
        data = await vestingService.fetchBNBVestingData(address, provider || undefined);
      } else if (chain === 'solana' && solanaConnection) {
        data = await vestingService.fetchSolanaVestingData(address, solanaConnection);
      }

      setVestingData(data);
      setLastUpdated(new Date());

      if (!data) {
        setError('No vesting data found for this chain');
      }
    } catch (err: any) {
      console.error('Failed to fetch vesting data:', err);
      setError(err.message || 'Failed to fetch vesting data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVestingData();
  }, [chain, address, provider, solanaConnection]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchVestingData();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, chain, address]);

  const handleManualRefresh = () => {
    fetchVestingData();
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  if (loading && !vestingData) {
    return (
      <div className="vesting-dashboard">
        <LoadingSpinner message="Loading vesting data..." />
      </div>
    );
  }

  if (error && !vestingData) {
    return (
      <div className="vesting-dashboard">
        <ErrorMessage 
          message={error} 
          onRetry={fetchVestingData}
        />
      </div>
    );
  }

  if (!vestingData) {
    return (
      <div className="vesting-dashboard">
        <div className="no-data">
          <h3>No Vesting Data Found</h3>
          <p>
            No vesting schedule found for the current chain ({chain}). 
            This could mean:
          </p>
          <ul>
            <li>No vesting contract has been deployed</li>
            <li>The vesting schedule hasn't been initialized</li>
            <li>You're connected to the wrong network</li>
          </ul>
          <button className="retry-btn" onClick={fetchVestingData}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const showFullData = !isConnected || vestingData.userRole.isInitializer;
  const showUserData = isConnected && vestingData.userRole.isRecipient;
  const showNotRecipient = isConnected && !vestingData.userRole.isRecipient && !vestingData.userRole.isInitializer;

  return (
    <div className="vesting-dashboard">
      {/* Controls */}
      <div className="dashboard-controls">
        <button 
          className="refresh-btn"
          onClick={handleManualRefresh}
          disabled={loading}
          title="Refresh data"
        >
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
        
        <label className="auto-refresh-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={toggleAutoRefresh}
          />
          Auto-refresh (30s)
        </label>
        
        {lastUpdated && (
          <span className="last-updated">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Connection Status */}
      {isConnected && address && (
        <div className="connection-status">
          <div className="status-item">
            <span className="label">Connected Address:</span>
            <span className="value">{address}</span>
          </div>
          <div className="status-item">
            <span className="label">Role:</span>
            <span className="value">
              {vestingData.userRole.isInitializer && 'Initializer'}
              {vestingData.userRole.isRecipient && 'Recipient'}
              {!vestingData.userRole.isInitializer && !vestingData.userRole.isRecipient && 'Not a recipient'}
            </span>
          </div>
        </div>
      )}

      {/* Not Recipient Message */}
      {showNotRecipient && (
        <div className="not-recipient-message">
          <h3>You are not a recipient</h3>
          <p>
            Your connected wallet address is not in the recipient list for this vesting schedule.
            You can view basic information about the vesting contract below.
          </p>
        </div>
      )}

      {/* Vesting Overview - Always shown */}
      <VestingOverview 
        schedule={vestingData.schedule}
        progress={vestingData.progress}
        claimStatus={vestingData.claimStatus}
      />

      {/* Detailed Information */}
      <VestingDetails 
        schedule={vestingData.schedule}
        progress={vestingData.progress}
        chain={chain}
      />

      {/* Recipients List - Show based on role */}
      <RecipientsList 
        recipients={vestingData.recipients}
        totalAmount={vestingData.schedule.totalAmount}
        userRole={vestingData.userRole}
        showFullList={showFullData}
        chain={chain} 
      />

      {error && (
        <ErrorMessage 
          message={error} 
          onRetry={fetchVestingData}
          className="dashboard-error"
        />
      )}
    </div>
  );
};