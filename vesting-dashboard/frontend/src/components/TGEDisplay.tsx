// src/components/TGEDisplay.tsx
import React from 'react';
import type { VestingSchedule } from '../types/vesting';
import { Zap, Info } from 'lucide-react';

interface TGEDisplayProps {
  schedule: VestingSchedule;
}

export const TGEDisplay: React.FC<TGEDisplayProps> = ({ schedule }) => {
  // Only show TGE for Solana chain
  if (schedule.chain !== 'solana' || !schedule.tgePercentage) {
    return null;
  }

  return (
    <div className="tge-display">
      <div className="tge-header">
        <Zap size={20} />
        <h4>Token Generation Event (TGE)</h4>
      </div>
      <div className="tge-content">
        <div className="tge-percentage">
          <span className="tge-value">{schedule.tgePercentage}%</span>
          <span className="tge-label">Available immediately</span>
        </div>
        <div className="tge-info">
          <Info size={16} />
          <span>TGE tokens are unlocked at funding time</span>
        </div>
      </div>
      
      <style>{`
        .tge-display {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
          color: white;
        }
        
        .tge-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        
        .tge-header h4 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        
        .tge-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .tge-percentage {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        
        .tge-value {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        
        .tge-label {
          font-size: 12px;
          opacity: 0.9;
        }
        
        .tge-info {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          opacity: 0.9;
        }
        
        @media (max-width: 768px) {
          .tge-display {
            padding: 12px;
            margin: 12px 0;
          }
          
          .tge-value {
            font-size: 20px;
          }
        }
      `}</style>
    </div>
  );
};