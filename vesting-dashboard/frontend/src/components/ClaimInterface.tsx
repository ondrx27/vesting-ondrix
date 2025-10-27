// src/components/ClaimInterface.tsx - Better config access approach
import React, { useState, useEffect } from 'react';
import { VestingService } from '../services/vestingService';
import type { VestingData, SupportedChain } from '../types/vesting';
import { Clock, DollarSign, AlertTriangle, CheckCircle, ExternalLink, Wifi, WifiOff } from 'lucide-react';

interface ClaimInterfaceProps {
  vestingData: VestingData;
  chain: SupportedChain;
  userAddress: string;
  onClaimSuccess: () => void;
}

export const ClaimInterface: React.FC<ClaimInterfaceProps> = ({
  vestingData,
  chain,
  userAddress,
  onClaimSuccess
}) => {
  // ✅ UPDATED: Hide ClaimInterface for BNB recipients (they should use IndividualClaimButton)
  // Only show for initializers or Solana users
  if (chain === 'bnb' && vestingData.userRole.isRecipient && !vestingData.userRole.isInitializer) {
    return null; // BNB recipients use IndividualClaimButton instead
  }
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{
    success: boolean;
    transactionHash?: string;
    error?: string;
    distributedAmount?: string;
  } | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [backendHealthy, setBackendHealthy] = useState<boolean>(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const vestingService = new VestingService();

  useEffect(() => {
    checkBackendHealth();
  }, []);

  const checkBackendHealth = async () => {
    const health = await vestingService.checkBackendHealth();
    setBackendHealthy(health.healthy);
    setBackendError(health.error || null);
  };

  useEffect(() => {
    if (!vestingData.claimStatus.timeRemaining) return;

    setCountdown(vestingData.claimStatus.timeRemaining);
    
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onClaimSuccess(); 
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [vestingData.claimStatus.timeRemaining]);

  const formatCountdown = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getBeneficiaryAddress = (): string => {
    if (chain === 'bnb') {
      return '0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC'; 
    } else {
      return import.meta.env.VITE_SOLANA_VESTING_PDA || 'GFZRzf3S5siZ9ooYyLKD16qUPWNWvaMMv6qhWyZRnPKa';
    }
  };

  const handleClaim = async () => {
    if (!backendHealthy) {
      setClaimResult({
        success: false,
        error: 'Backend service is currently unavailable. Please try again later.'
      });
      return;
    }

    setClaiming(true);
    setClaimResult(null);

    try {
      const beneficiaryAddress = getBeneficiaryAddress();

      const response = await vestingService.requestClaim({
        beneficiaryAddress,
        chain,
        userAddress, 
        signature: 'frontend-request' 
      });

      setClaimResult(response);

      if (response.success) {
        setTimeout(() => {
          onClaimSuccess();
        }, 2000);
      }

    } catch (error: any) {
      setClaimResult({
        success: false,
        error: error.message || 'Failed to claim tokens'
      });
    } finally {
      setClaiming(false);
    }
  };

  const canClaim = vestingData.claimStatus.canClaim && 
                  BigInt(vestingData.progress.claimableAmount) > 0n &&
                  backendHealthy;

  return (
    <div className="claim-interface">
      <h3 className="claim-title">
        <DollarSign size={20} />
        Token Claim
      </h3>

      {/* Backend Status */}
      <div className="backend-status">
        <div className={`status-indicator ${backendHealthy ? 'status-healthy' : 'status-unhealthy'}`}>
          {backendHealthy ? (
            <>
              <Wifi size={16} />
              <span>Backend service online</span>
            </>
          ) : (
            <>
              <WifiOff size={16} />
              <span>Backend service offline</span>
            </>
          )}
        </div>
        {backendError && (
          <div className="backend-error">
            <AlertTriangle size={14} />
            <span>{backendError}</span>
          </div>
        )}
      </div>

      {/* Claim Status */}
      <div className="claim-status">
        {canClaim ? (
          <div className="status-available">
            <CheckCircle size={16} />
            <span>Tokens available for claim</span>
          </div>
        ) : (
          <div className="status-waiting">
            <Clock size={16} />
            <span>{vestingData.claimStatus.reason}</span>
          </div>
        )}
      </div>

      {/* Countdown Timer */}
      {countdown > 0 && (
        <div className="countdown-timer">
          <div className="countdown-display">
            <Clock size={24} />
            <div className="countdown-text">
              <div className="countdown-time">{formatCountdown(countdown)}</div>
              <div className="countdown-label">until next unlock</div>
            </div>
          </div>
          {vestingData.claimStatus.nextUnlockPercentage && (
            <div className="next-unlock-info">
              Next unlock: {vestingData.claimStatus.nextUnlockPercentage}% of total tokens
            </div>
          )}
        </div>
      )}

      {/* Claimable Amount */}
      {canClaim && (
        <div className="claimable-amount">
          <div className="amount-display">
            <span className="amount">
              {vestingService.formatTokenAmount(
                vestingData.progress.claimableAmount,
                chain === 'solana' ? 9 : 18
              )}
            </span>
            <span className="token-label">tokens</span>
          </div>
          <div className="amount-note">
            Available to claim and distribute to recipients
          </div>
        </div>
      )}

      {/* Distribution Preview */}
      {canClaim && vestingData.userRole.isInitializer && (
        <div className="distribution-preview">
          <h4>Distribution Preview</h4>
          <div className="distribution-list">
            {vestingData.recipients.map((recipient, index) => {
              const share = (BigInt(vestingData.progress.claimableAmount) * BigInt(recipient.percentage || 0)) / 100n;
              return (
                <div key={index} className="distribution-item">
                  <span className="recipient-address">
                    {recipient.wallet.slice(0, 6)}...{recipient.wallet.slice(-4)}
                  </span>
                  <span className="distribution-amount">
                    {vestingService.formatTokenAmount(share.toString(), chain === 'solana' ? 9 : 18)} 
                    ({recipient.percentage}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recipient Preview */}
      {canClaim && vestingData.userRole.isRecipient && vestingData.userRole.recipientData && (
        <div className="recipient-preview">
          <h4>Your Share</h4>
          <div className="share-info">
            <div className="share-percentage">
              {vestingData.userRole.recipientData.percentage}% of claimable tokens
            </div>
            <div className="share-amount">
              {vestingService.formatTokenAmount(
                ((BigInt(vestingData.progress.claimableAmount) * BigInt(vestingData.userRole.recipientData.percentage || 0)) / 100n).toString(),
                chain === 'solana' ? 9 : 18
              )} tokens
            </div>
          </div>
        </div>
      )}

      {/* Claim Button */}
      <div className="claim-actions">
        {canClaim ? (
          <button
            className="claim-btn"
            onClick={handleClaim}
            disabled={claiming || !backendHealthy}
          >
            {claiming ? (
              <>
                <div className="spinner small" />
                {vestingData.userRole.isInitializer ? 'Distributing...' : 'Claiming...'}
              </>
            ) : (
              <>
                <DollarSign size={18} />
                {vestingData.userRole.isInitializer ? 'Distribute to All Recipients' : 'Claim Your Tokens'}
              </>
            )}
          </button>
        ) : (
          <button className="claim-btn disabled" disabled>
            <Clock size={18} />
            {!backendHealthy ? 'Backend service unavailable' : vestingData.claimStatus.reason}
          </button>
        )}
      </div>

      {/* Security Notice */}
      <div className="security-notice">
        <AlertTriangle size={16} />
        <div className="notice-text">
          <strong>Security Notice:</strong> Claims are processed securely through our backend service. 
          Your private keys never leave your wallet. The backend handles the distribution while keeping 
          all private keys secure on the server.
        </div>
      </div>

      {/* Claim Result */}
      {claimResult && (
        <div className={`claim-result ${claimResult.success ? 'success' : 'error'}`}>
          {claimResult.success ? (
            <>
              <CheckCircle size={20} />
              <div className="result-content">
                <div className="result-title">Claim Successful!</div>
                {claimResult.distributedAmount && (
                  <div className="result-amount">
                    Distributed: {vestingService.formatTokenAmount(
                      claimResult.distributedAmount,
                      chain === 'solana' ? 9 : 18
                    )} tokens
                  </div>
                )}
                {claimResult.transactionHash && (
                  <a
                    href={vestingService.getExplorerUrl(chain, claimResult.transactionHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="view-transaction"
                  >
                    <ExternalLink size={14} />
                    View Transaction
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              <AlertTriangle size={20} />
              <div className="result-content">
                <div className="result-title">Claim Failed</div>
                <div className="result-error">{claimResult.error}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Next Unlock Information */}
      {!canClaim && vestingData.claimStatus.nextUnlockTime && (
        <div className="next-unlock-info">
          <h4>Next Unlock Schedule</h4>
          <div className="unlock-timeline">
            <div className="unlock-item">
              <span className="unlock-time">
                {new Date(vestingData.claimStatus.nextUnlockTime * 1000).toLocaleString()}
              </span>
              <span className="unlock-percentage">
                {vestingData.claimStatus.nextUnlockPercentage}% of total tokens
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Backend Health Check Button */}
      {!backendHealthy && (
        <div className="backend-actions">
          <button 
            className="health-check-btn"
            onClick={checkBackendHealth}
          >
            <Wifi size={16} />
            Check Backend Status
          </button>
        </div>
      )}
    </div>
  );
};