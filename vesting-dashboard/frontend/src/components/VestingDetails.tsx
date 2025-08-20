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
        return `${quotient}.${trimmed}`;
      }
    } catch (error) {
      return '0';
    }
  };

  const vestingPeriods = [
    { 
      name: 'Period 1', 
      time: '5 minutes', 
      percentage: 10, 
      unlocked: progress.currentPeriod >= 1 
    },
    { 
      name: 'Period 2', 
      time: '10 minutes', 
      percentage: 20, 
      unlocked: progress.currentPeriod >= 2 
    },
    { 
      name: 'Period 3', 
      time: '15 minutes', 
      percentage: 50, 
      unlocked: progress.currentPeriod >= 3 
    },
    { 
      name: 'Period 4', 
      time: '20 minutes', 
      percentage: 100, 
      unlocked: progress.currentPeriod >= 4 
    },
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