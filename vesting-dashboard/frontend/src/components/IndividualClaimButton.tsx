// src/components/IndividualClaimButton.tsx
import React, { useState } from 'react';
import type { VestingData, SupportedChain } from '../types/vesting';
import { DollarSign, ExternalLink, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { VestingService } from '../services/vestingService';
import { useWallet } from '../contexts/WalletContext';

interface IndividualClaimButtonProps {
  vestingData: VestingData;
  chain: SupportedChain;
  userAddress: string;
  onClaimSuccess: () => void;
}

export const IndividualClaimButton: React.FC<IndividualClaimButtonProps> = ({
  vestingData,
  chain,
  userAddress,
  onClaimSuccess
}) => {
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{
    success: boolean;
    transactionHash?: string;
    error?: string;
    amount?: string;
  } | null>(null);

  const { provider, connect, disconnect, reownProvider, reownAddress } = useWallet();
  const vestingService = new VestingService();

  // Show button only for BNB recipients with connected wallet  
  if (chain !== 'bnb' || !vestingData.userRole.isRecipient || !userAddress) {
    return null;
  }

  // Check if there are claimable tokens
  const hasClaimableTokens = vestingData.progress.canClaimNow && 
                            BigInt(vestingData.progress.claimableAmount) > 0n;

  const getRecipientAllocation = (): bigint => {
    if (!vestingData.userRole.recipientData) return 0n;
    
    // For individual recipients, show their personal claimable amount
    // not a percentage of the total claimable amount
    if (vestingData.userRole.recipientData.claimedAmount !== undefined) {
      const totalAmount = BigInt(vestingData.schedule.totalAmount);
      const claimedAmount = BigInt(vestingData.userRole.recipientData.claimedAmount);
      const basisPoints = BigInt(vestingData.userRole.recipientData.basisPoints || (vestingData.userRole.recipientData.percentage || 0) * 100);
      
      // Calculate personal allocation: (totalAmount * basisPoints) / 10000
      const personalAllocation = (totalAmount * basisPoints) / 10000n;
      const personalClaimable = personalAllocation - claimedAmount;
      
      return personalClaimable > 0n ? personalClaimable : 0n;
    }
    
    // Fallback to old calculation if no basis points data
    const totalClaimable = BigInt(vestingData.progress.claimableAmount);
    const recipientPercentage = BigInt(vestingData.userRole.recipientData.percentage || 0);
    
    return (totalClaimable * recipientPercentage) / 100n;
  };

  const formatTokenAmount = (amount: string): string => {
    try {
      const value = BigInt(amount);
      const divisor = BigInt(10 ** 18); // BNB uses 18 decimals
      const quotient = value / divisor;
      const remainder = value % divisor;
      
      if (remainder === 0n) {
        return quotient.toString();
      } else {
        const remainderStr = remainder.toString().padStart(18, '0');
        const trimmed = remainderStr.replace(/0+$/, '');
        // Limit to 3 decimal places
        const limitedDecimals = trimmed.length > 3 ? trimmed.substring(0, 3) : trimmed;
        return `${quotient}.${limitedDecimals}`;
      }
    } catch (error) {
      return '0';
    }
  };

  const getBeneficiaryAddress = (): string => {
    return '0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC'; 
  };

  const handleIndividualClaim = async () => {
    if (claiming) return;

    // Use only Reown provider for BNB chain
    if (!reownProvider || !reownAddress) {
      setClaimResult({
        success: false,
        error: 'Please connect your wallet using WalletConnect'
      });
      return;
    }

    const claimProvider = reownProvider;
    const connectionType = 'WalletConnect/Reown';

    setClaiming(true);
    setClaimResult(null);

    try {
      const beneficiaryAddress = getBeneficiaryAddress();

      console.log(`🚀 Starting direct claim with ${connectionType} provider`, {
        userAddress,
        reownAddress,
        hasReownProvider: !!reownProvider
      });
      
      const response = await vestingService.directClaimTokens(
        beneficiaryAddress,
        claimProvider
      );

      setClaimResult(response);

      if (response.success) {
        setTimeout(() => {
          onClaimSuccess();
        }, 2000);
      }

    } catch (error: any) {
      console.error('❌ Individual claim error:', error);
      setClaimResult({
        success: false,
        error: error.message || 'Failed to claim tokens'
      });
    } finally {
      setClaiming(false);
    }
  };

  const recipientAllocation = getRecipientAllocation();

  return (
    <div className="individual-claim-section">
      <div className="individual-claim-header">
        <h3>
          <DollarSign size={18} />
          Individual Claim
        </h3>
        <p className="claim-description">
          As a recipient, you can claim your allocated tokens directly to your wallet
        </p>
      </div>

      {vestingData.userRole.recipientData && (
        <div className="recipient-allocation">
          <div className="allocation-info">
            <span className="label">Your allocation:</span>
            <span className="value">{vestingData.userRole.recipientData.percentage}%</span>
          </div>
          {hasClaimableTokens && recipientAllocation > 0n && (
            <div className="claimable-info">
              <span className="label">Available to claim:</span>
              <span className="value">{formatTokenAmount(recipientAllocation.toString())} tokens</span>
            </div>
          )}
        </div>
      )}

      {hasClaimableTokens && recipientAllocation > 0n ? (
        <button
          className="individual-claim-btn"
          onClick={handleIndividualClaim}
          disabled={claiming}
        >
          {claiming ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Claiming...
            </>
          ) : (
            <>
              <DollarSign size={18} />
              Claim My Tokens
            </>
          )}
        </button>
      ) : (
        <div className="no-claim-available">
          <AlertTriangle size={16} />
          <span>
            {!hasClaimableTokens 
              ? 'No tokens available to claim yet' 
              : 'Your claimable amount is 0'}
          </span>
        </div>
      )}

      {/* Claim Result */}
      {claimResult && (
        <div className={`claim-result ${claimResult.success ? 'success' : 'error'}`}>
          {claimResult.success ? (
            <>
              <CheckCircle size={20} />
              <div className="result-content">
                <div className="result-title">Claim Successful!</div>
                {claimResult.amount && (
                  <div className="result-amount">
                    Claimed: {formatTokenAmount(claimResult.amount)} tokens
                  </div>
                )}
                {claimResult.transactionHash && (
                  <a
                    href={`https://testnet.bscscan.com/tx/${claimResult.transactionHash}`}
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

      <div className="individual-claim-notice">
        <AlertTriangle size={14} />
        <span>
          Individual claiming uses WalletConnect. Confirm transaction on your mobile wallet and make sure you have enough BNB for transaction fees.
        </span>
      </div>

      {/* Show refresh hint if there was a -32002 error */}
      {claimResult && !claimResult.success && (
        claimResult.error?.includes('pending') || 
        claimResult.error?.includes('No accounts available') ||
        claimResult.error?.includes('MetaMask has pending')
      ) && (
        <div className="pending-error-hint" style={{ 
          marginTop: '10px', 
          padding: '10px', 
          backgroundColor: '#fff3cd', 
          border: '1px solid #ffeaa7', 
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          <strong>💡 MetaMask Connection Issue:</strong>
          <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
            <li>Open MetaMask and clear any pending notifications</li>
            <li>Click "Reset Connection" below</li>
            <li>Try claiming again</li>
          </ol>
          <button 
            onClick={async () => {
              try {
                await disconnect();
                setTimeout(async () => {
                  await connect();
                  setClaimResult(null); // Clear error message
                }, 1000);
              } catch (error) {
                console.error('Reset connection failed:', error);
              }
            }}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🔄 Reset Connection
          </button>
        </div>
      )}
    </div>
  );
};