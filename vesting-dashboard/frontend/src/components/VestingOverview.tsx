// src/components/VestingOverview.tsx - Исправленная версия
import React from 'react';
import type { VestingSchedule, VestingProgress, ClaimStatus } from '../types/vesting';
import { Clock, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';

interface VestingOverviewProps {
  schedule: VestingSchedule;
  progress: VestingProgress;
  claimStatus: ClaimStatus;
}

export const VestingOverview: React.FC<VestingOverviewProps> = ({
  schedule,
  progress,
  claimStatus
}) => {
  const getTokenDecimals = (tokenAddress: string): number => {
    if (tokenAddress && !tokenAddress.startsWith('0x') && tokenAddress.length > 32) {
      return 9; 
    }
    return 18;
  };

  const decimals = getTokenDecimals(schedule.token);

  const formatTokenAmount = (amount: string): string => {
    try {
      const value = BigInt(amount);
      const divisor = BigInt(10 ** decimals);
      const quotient = value / divisor;
      const remainder = value % divisor;
      
      if (remainder === BigInt(0)) {
        return quotient.toString();
      } else {
        const remainderStr = remainder.toString().padStart(decimals, '0');
        const trimmed = remainderStr.replace(/0+$/, '');
        return `${quotient}.${trimmed}`;
      }
    } catch (error) {
      console.error('Error formatting token amount:', error, 'Amount:', amount, 'Decimals:', decimals);
      return '0';
    }
  };

  const getStatusIndicator = () => {
    if (schedule.startTime === 0) {
      return { color: 'gray', text: 'Not Started' };
    }
    
    if (progress.unlockedPercentage === 100) {
      return { color: 'blue', text: 'Completed' };
    }
    
    if (claimStatus.canClaim) {
      return { color: 'green', text: 'Claimable' };
    }
    
    return { color: 'orange', text: 'In Progress' };
  };

  const status = getStatusIndicator();

  const getCurrentPeriodDisplay = (): string => {
    if (progress.currentPeriod === 0) {
      return "0/4 (Pre-vesting)";
    }
    return `${progress.currentPeriod}/4`;
  };

  return (
    <div className="vesting-overview">
      <div className="overview-header">
        <h2>Vesting Overview</h2>
        <div className={`status-indicator status-${status.color}`}>
          <div className="status-dot" />
          {status.text}
        </div>
      </div>

      <div className="overview-grid">
        <div className="overview-card">
          <div className="card-header">
            <DollarSign size={20} />
            <h3>Total Amount</h3>
          </div>
          <div className="card-value">
            {formatTokenAmount(schedule.totalAmount)} tokens
          </div>
          <div className="card-subtitle">
            Total vesting allocation
          </div>
        </div>

        <div className="overview-card">
          <div className="card-header">
            <TrendingUp size={20} />
            <h3>Progress</h3>
          </div>
          <div className="card-value">
            {progress.unlockedPercentage}%
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${Math.min(progress.unlockedPercentage, 100)}%` }}
            />
          </div>
          <div className="card-subtitle">
            {progress.unlockedPercentage === 100 ? 'Fully unlocked' : 'Vesting in progress'}
          </div>
        </div>

        <div className="overview-card">
          <div className="card-header">
            <Clock size={20} />
            <h3>Current Period</h3>
          </div>
          <div className="card-value">
            {getCurrentPeriodDisplay()}
          </div>
          <div className="card-subtitle">
            {progress.currentPeriod === 0 ? 'Vesting not started' : 
             progress.currentPeriod === 4 ? 'All periods completed' :
             `Period ${progress.currentPeriod} active`}
          </div>
        </div>

        <div className="overview-card">
          <div className="card-header">
            <DollarSign size={20} />
            <h3>Available to Claim</h3>
          </div>
          <div className="card-value">
            {formatTokenAmount(progress.claimableAmount)} tokens
          </div>
          <div className="card-subtitle">
            {BigInt(progress.claimableAmount) > 0n ? 'Ready to claim' : 
             progress.unlockedPercentage === 100 ? 'All tokens claimed' : 
             'Not yet available'}
          </div>
        </div>
      </div>

      {/* ✅ УЛУЧШЕННЫЙ статус баннер */}
      {claimStatus.reason && (
        <div className={`claim-status-banner ${
          claimStatus.canClaim ? 'status-success' : 
          progress.unlockedPercentage === 100 ? 'status-complete' : 
          'status-info'
        }`}>
          <AlertCircle size={16} />
          <span>{claimStatus.reason}</span>
        </div>
      )}
    </div>
  );
};