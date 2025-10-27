import React, { useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useAutoDistribution } from '../hooks/useAutoDistribution';
import { Activity, Clock, TrendingUp, Zap, ExternalLink, AlertCircle, RefreshCw, Wifi, WifiOff, Lock } from 'lucide-react';

const ADMIN_ADDRESSES = {
  bnb: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
  solana: '8MygYWsJDxPwCVVfcNuNUrFMToTgokMv6i2AxmrErjJf'
};

export const AutoDistributionDashboard: React.FC = () => {
  const { address, chain, isConnected } = useWallet();
  const autoDistribution = useAutoDistribution();

  const isAdmin = React.useMemo(() => {
    if (!isConnected || !address || !chain) {
      return false;
    }
    
    const adminAddress = ADMIN_ADDRESSES[chain as keyof typeof ADMIN_ADDRESSES];
    if (!adminAddress) {
      return false;
    }
    
    return address.toLowerCase() === adminAddress.toLowerCase();
  }, [isConnected, address, chain]);

  if (!isAdmin) {
    return null;
  }

  const {
    isConnected: backendConnected,
    stats,
    contracts,
    recentDistributions,
    isLoading,
    error,
    controlService,
    refresh,
    testConnection,
    clearError,
    backendUrl
  } = autoDistribution;

  const formatAddress = (addressStr: string) => {
    if (!addressStr) return 'N/A';
    return `${addressStr.slice(0, 6)}...${addressStr.slice(-4)}`;
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    return isNaN(num) ? '0' : num.toLocaleString();
  };

  const getExplorerUrl = (chainType: string, txHash: string) => {
    if (chainType === 'solana') {
      return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
    } else {
      return `https://testnet.bscscan.com/tx/${txHash}`;
    }
  };

  const handleTestConnection = async () => {
    try {
      await testConnection();
    } catch (error) {
      console.error('Connection test failed:', error);
    }
  };

  const handleRefresh = async () => {
    try {
      await Promise.all([
        refresh.stats(),
        refresh.contracts()
      ]);
    } catch (error) {
      console.error('Refresh failed:', error);
    }
  };

  return (
    <div className="auto-distribution-dashboard">
      {/* Admin Badge */}
      <div className="admin-badge">
        <Lock size={16} />
        <span>Admin Panel - Auto Distribution</span>
      </div>

      <div className="dashboard-header">
        <h2>🤖 Automatic Token Distribution</h2>
        
        <div className="header-controls">
          {/* Статус подключения */}
          <div className={`connection-indicator ${backendConnected ? 'connected' : 'disconnected'}`}>
            {backendConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{backendConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          
          {/* Управление сервисом */}
          <div className="service-status">
            <div className={`status-indicator ${stats?.isRunning ? 'running' : 'stopped'}`}>
              <Zap size={16} />
              <span>{stats?.isRunning ? 'Running' : 'Stopped'}</span>
            </div>
            
            <div className="service-controls">
              {stats?.isRunning ? (
                <button 
                  className="control-btn stop"
                  onClick={controlService.stop}
                  disabled={isLoading || !backendConnected}
                >
                  {isLoading ? 'Stopping...' : 'Stop Service'}
                </button>
              ) : (
                <button 
                  className="control-btn start"
                  onClick={controlService.start}
                  disabled={isLoading || !backendConnected}
                >
                  {isLoading ? 'Starting...' : 'Start Service'}
                </button>
              )}
            </div>
          </div>
          
          {/* Кнопка обновления */}
          <button 
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh data"
          >
            <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Информация о подключении */}
      {!backendConnected && (
        <div className="connection-status">
          <AlertCircle size={24} />
          <div>
            <p>Connecting to auto distribution service...</p>
            <p className="backend-url">Backend: {backendUrl}</p>
            <button onClick={handleTestConnection} disabled={isLoading}>
              {isLoading ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      )}

      {/* Баннер ошибки */}
      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={clearError} className="close-error">×</button>
        </div>
      )}

      {/* Статистика */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{stats?.totalContracts || 0}</div>
            <div className="stat-label">Total Contracts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{stats?.activeContracts || 0}</div>
            <div className="stat-label">Active Contracts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{recentDistributions?.length || 0}</div>
            <div className="stat-label">Recent Distributions</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon chain-solana">
            🌞
          </div>
          <div className="stat-content">
            <div className="stat-value">{stats?.solanaContracts || 0}</div>
            <div className="stat-label">Solana Contracts</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon chain-bnb">
            🟡
          </div>
          <div className="stat-content">
            <div className="stat-value">{stats?.bnbContracts || 0}</div>
            <div className="stat-label">BNB Contracts</div>
          </div>
        </div>
      </div>

      {/* Список контрактов */}
      <div className="contracts-section">
        <h3>📋 Monitored Contracts</h3>
        
        {!contracts || contracts.length === 0 ? (
          <div className="no-contracts">
            <p>No contracts are currently being monitored.</p>
          </div>
        ) : (
          <div className="contracts-list">
            {contracts.map((contract) => (
              <div key={contract.id} className="contract-item">
                <div className="contract-header">
                  <div className={`chain-badge ${contract.chain}`}>
                    {contract.chain.toUpperCase()}
                  </div>
                  <div className={`status-badge ${contract.isActive ? 'active' : 'inactive'}`}>
                    {contract.isActive ? 'Active' : 'Inactive'}
                  </div>
                </div>
                
                <div className="contract-details">
                  <div className="contract-info">
                    <strong>Address:</strong> {formatAddress(contract.address)}
                  </div>
                  <div className="contract-info">
                    <strong>Recipients:</strong> {contract.recipients?.length || 0}
                  </div>
                  <div className="contract-info">
                    <strong>Start Time:</strong> {
                      contract.startTime && contract.startTime > 0 
                        ? new Date(contract.startTime * 1000).toLocaleString()
                        : 'Not started'
                    }
                  </div>
                  <div className="contract-info">
                    <strong>Last Distribution:</strong> {
                      contract.lastDistributionTime && contract.lastDistributionTime > 0 
                        ? new Date(contract.lastDistributionTime * 1000).toLocaleString()
                        : 'Never'
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Последние раздачи */}
      <div className="recent-distributions">
        <h3>📊 Recent Distributions</h3>
        
        {!recentDistributions || recentDistributions.length === 0 ? (
          <div className="no-distributions">
            <Clock size={32} />
            <p>No distributions yet. Waiting for vesting periods...</p>
            <p className="hint">Distributions happen automatically at 5, 10, 15, and 20 minutes after vesting start.</p>
          </div>
        ) : (
          <div className="distributions-list">
            {recentDistributions.map((distribution, index) => (
              <div key={`${distribution.transactionHash}-${index}`} className="distribution-item">
                <div className="distribution-header">
                  <div className={`chain-badge ${distribution.chain}`}>
                    {distribution.chain.toUpperCase()}
                  </div>
                  <div className="distribution-time">
                    {new Date(distribution.timestamp * 1000).toLocaleString()}
                  </div>
                </div>
                
                <div className="distribution-content">
                  <div className="distribution-amount">
                    💰 {formatAmount(distribution.amount)} tokens distributed
                  </div>
                  
                  <div className="recipients-summary">
                    👥 {distribution.recipients?.length || 0} recipients
                  </div>
                  
                  <div className="transaction-link">
                    <a 
                      href={getExplorerUrl(distribution.chain, distribution.transactionHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="explorer-link"
                    >
                      View Transaction <ExternalLink size={16} />
                    </a>
                  </div>
                </div>

                {distribution.recipients && distribution.recipients.length > 0 && (
                  <div className="recipients-details">
                    {distribution.recipients.map((recipient, idx) => (
                      <div key={idx} className="recipient-row">
                        <span className="recipient-address">
                          {formatAddress(recipient.wallet)}
                        </span>
                        <span className="recipient-amount">
                          +{formatAmount(recipient.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Информация о работе сервиса */}
      <div className="service-info">
        <h3>ℹ️ How Auto Distribution Works</h3>
        <div className="info-grid">
          <div className="info-item">
            <Clock size={20} />
            <div>
              <strong>Automatic Timing</strong>
              <p>Tokens are automatically distributed at:</p>
              <ul>
                <li>5 minutes: 10%</li>
                <li>10 minutes: 20%</li>
                <li>15 minutes: 50%</li>
                <li>20 minutes: 100%</li>
              </ul>
            </div>
          </div>
          
          <div className="info-item">
            <Zap size={20} />
            <div>
              <strong>Real-time Updates</strong>
              <p>Your dashboard updates automatically when distributions occur. No manual action required!</p>
            </div>
          </div>
          
          <div className="info-item">
            <TrendingUp size={20} />
            <div>
              <strong>Multi-chain Support</strong>
              <p>Supports both Solana and BNB Smart Chain vesting contracts simultaneously.</p>
            </div>
          </div>
          
          <div className="info-item">
            <Activity size={20} />
            <div>
              <strong>Monitoring Status</strong>
              <p>Service checks for distribution opportunities every 30 seconds. Current status: {stats?.isRunning ? '🟢 Running' : '🔴 Stopped'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};