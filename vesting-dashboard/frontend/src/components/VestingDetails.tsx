// src/components/VestingDetails.tsx - Исправленная версия
import React from 'react';
import type { VestingSchedule, VestingProgress, SupportedChain } from '../types/vesting';
import { Calendar, Clock, Coins } from 'lucide-react';

interface VestingDetailsProps {
  schedule: VestingSchedule;
  progress: VestingProgress;
  chain: SupportedChain;
}

export const VestingDetails: React.FC<VestingDetailsProps> = ({
  schedule,
  progress,
  chain
}) => {
  const formatDuration = (seconds: number): string => {
    if (seconds <= 0) return 'No cliff';

    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);

    if (months > 0) return `${months} month${months > 1 ? 's' : ''}`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  };

  const getTokenDecimals = (): number => {
    return chain === 'solana' ? 9 : 18;
  };

  const formatTokenAmount = (amount: string): string => {
    try {
      const decimals = getTokenDecimals();
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
      return '0';
    }
  };

  // ✅ FIX: Different timeline logic for different chains
  const vestingPeriods = schedule.chain === 'solana' ? [
    {
      name: 'TGE',
      time: 'Immediate',
      percentage: schedule.tgeBasisPoints ? schedule.tgeBasisPoints / 100 : (schedule.tgePercentage || 15),
      unlocked: progress.currentPeriod >= 1
    },
    {
      name: 'After Cliff',
      time: formatDuration(schedule.cliffDuration || 7776000),
      percentage: schedule.tgeBasisPoints ? schedule.tgeBasisPoints / 100 + 15 : 30,
      unlocked: progress.currentPeriod >= 2
    },
    {
      name: 'Mid Vesting',
      time: formatDuration((schedule.vestingDuration || 23328000) * 0.75),
      percentage: 75,
      unlocked: progress.currentPeriod >= 3
    },
    {
      name: 'Full Vesting',
      time: formatDuration(schedule.vestingDuration || 23328000),
      percentage: 100,
      unlocked: progress.currentPeriod >= 4
    }
  ] : [
    // BNB: TGE + linear vesting after cliff (same as Solana)
    {
      name: 'TGE',
      time: 'Immediate',
      percentage: schedule.tgeBasisPoints ? schedule.tgeBasisPoints / 100 : (schedule.tgePercentage || 15),
      unlocked: progress.currentPeriod >= 1
    },
    {
      name: 'After Cliff',
      time: formatDuration(schedule.cliffDuration || 7776000),
      percentage: schedule.tgeBasisPoints ? schedule.tgeBasisPoints / 100 + 15 : 30,
      unlocked: progress.currentPeriod >= 2
    },
    {
      name: 'Mid Vesting',
      time: formatDuration((schedule.vestingDuration || 23328000) * 0.75),
      percentage: 75,
      unlocked: progress.unlockedPercentage >= 75
    },
    {
      name: 'Full Vesting',
      time: formatDuration(schedule.vestingDuration || 23328000),
      percentage: 100,
      unlocked: progress.unlockedPercentage >= 100
    }
  ];

  return (
    <div className="vesting-details">
      <h3>Vesting Details</h3>
      

      
      <div className="details-grid">
        <div className="detail-section">
          <div className="section-header">
            <Calendar size={18} />
            <h4>Schedule Information</h4>
          </div>
          <div className="detail-items">
            <div className="detail-item">
              <span className="label">Start Time:</span>
              <span className="value">
                {schedule.startTime > 0 
                  ? new Date(schedule.startTime * 1000).toLocaleString()
                  : 'Not started'
                }
              </span>
            </div>
            <div className="detail-item">
              <span className="label">Cliff Duration:</span>
              <span className="value">{formatDuration(schedule.cliffDuration)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Vesting Duration:</span>
              <span className="value">{formatDuration(schedule.vestingDuration)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Recipients:</span>
              <span className="value">{schedule.recipientCount}</span>
            </div>
            {/* ✅ FIX: Show TGE for both chains */}
            {(schedule.tgeBasisPoints || schedule.tgePercentage) && (
              <div className="detail-item">
                <span className="label">TGE Release:</span>
                <span className="value">
                  {schedule.tgeBasisPoints ? (schedule.tgeBasisPoints / 100) : schedule.tgePercentage}%
                </span>
              </div>
            )}
            {schedule.isFinalized !== undefined && (
              <div className="detail-item">
                <span className="label">Status:</span>
                <span className={`value ${schedule.isFinalized ? 'status-finalized' : 'status-pending'}`}>
                  {schedule.isFinalized ? '✅ Finalized' : '⏳ Pending Finalization'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="detail-section">
          <div className="section-header">
            <Coins size={18} />
            <h4>Token Information</h4>
          </div>
          <div className="detail-items">
            <div className="detail-item">
              <span className="label">Total Amount:</span>
              <span className="value">
                {formatTokenAmount(schedule.totalAmount)} tokens
              </span>
            </div>
            <div className="detail-item">
              <span className="label">Claimed:</span>
              <span className="value">
                {formatTokenAmount(schedule.claimedAmount)} tokens
              </span>
            </div>
            <div className="detail-item">
              <span className="label">Unlocked:</span>
              <span className="value">
                {formatTokenAmount(progress.unlockedAmount)} tokens
              </span>
            </div>
            <div className="detail-item">
              <span className="label">Remaining:</span>
              <span className="value">
                {formatTokenAmount(progress.remainingAmount)} tokens
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="vesting-timeline">
        <div className="timeline-header">
          <Clock size={18} />
          <h4>Vesting Timeline</h4>
        </div>
        <div className="timeline-periods">
          {vestingPeriods.map((period, index) => (
            <div 
              key={index} 
              className={`timeline-period ${period.unlocked ? 'unlocked' : 'locked'}`}
            >
              <div className="period-indicator">
                <div className="period-dot" />
                {index < vestingPeriods.length - 1 && <div className="period-line" />}
              </div>
              <div className="period-content">
                <div className="period-title">{period.name}</div>
                <div className="period-time">After {period.time}</div>
                <div className="period-percentage">{period.percentage}% unlocked</div>
                {/* ✅ ИСПРАВЛЕНИЕ: Добавляем индикатор статуса */}
                <div className={`period-status ${period.unlocked ? 'status-unlocked' : 'status-locked'}`}>
                  {period.unlocked ? '✅ UNLOCKED' : '⏳ PENDING'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};