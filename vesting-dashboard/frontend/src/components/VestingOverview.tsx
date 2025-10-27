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
        // Limit to 3 decimal places
        const limitedDecimals = trimmed.length > 3 ? trimmed.substring(0, 3) : trimmed;
        return `${quotient}.${limitedDecimals}`;
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
    // ✅ FIX: Different logic for different chains
    if (schedule.chain === 'solana') {
      // Solana: TGE + Linear vesting periods
      if (progress.currentPeriod === 0) return "Pre-TGE";
      if (progress.currentPeriod === 1) return `TGE (${schedule.tgePercentage || 15}%)`;
      return `${progress.currentPeriod}/4 (Vesting)`;
    } else {
      // BNB: No TGE, only cliff + linear vesting
      if (progress.currentPeriod === 0) return "Pre-cliff";
      if (schedule.startTime > 0) {
        const currentTime = Math.floor(Date.now() / 1000);
        const elapsed = Math.max(0, currentTime - schedule.startTime);
        if (elapsed < schedule.cliffDuration) {
          return "Cliff period";
        }
        const progressPercent = Math.min(100, Math.max(0, 
          ((elapsed - schedule.cliffDuration) / (schedule.vestingDuration - schedule.cliffDuration)) * 100
        ));
        return `${Math.floor(progressPercent)}% vested`;
      }
      return "Not started";
    }
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
            <h3>{schedule.chain === 'solana' ? 'Current Period' : 'Vesting Status'}</h3>
          </div>
          <div className="card-value">
            {getCurrentPeriodDisplay()}
          </div>
          <div className="card-subtitle">
            {schedule.chain === 'solana' ? (
              progress.currentPeriod === 0 ? 'TGE not started' : 
              progress.currentPeriod === 1 ? 'TGE period active' :
              progress.currentPeriod === 4 ? 'All periods completed' :
              `Linear vesting period ${progress.currentPeriod} active`
            ) : (
              progress.currentPeriod === 0 ? 'Waiting for cliff to end' :
              progress.unlockedPercentage === 100 ? 'Fully vested' :
              'Linear vesting in progress'
            )}
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