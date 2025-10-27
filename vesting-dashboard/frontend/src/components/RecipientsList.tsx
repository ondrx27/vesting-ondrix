import React from 'react';
import type { Recipient, UserRole, SupportedChain } from '../types/vesting';
import { Users, Eye, EyeOff } from 'lucide-react';

interface RecipientsListProps {
  recipients: Recipient[];
  totalAmount: string;
  userRole: UserRole;
  showFullList: boolean;
  chain: SupportedChain; 
}

export const RecipientsList: React.FC<RecipientsListProps> = ({
  recipients,
  totalAmount,
  userRole,
  showFullList,
  chain
}) => {
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

  const formatAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const displayedRecipients = showFullList 
    ? recipients 
    : recipients.filter((_, index) => index === userRole.recipientIndex);

  if (!showFullList && !userRole.isRecipient) {
    return (
      <div className="recipients-section">
        <div className="section-header">
          <Users size={18} />
          <h3>Recipients ({recipients.length})</h3>
          <EyeOff size={16} className="visibility-icon" />
        </div>
        <div className="recipients-hidden">
          <p>Connect your wallet to view recipient information</p>
        </div>
      </div>
    );
  }

  return (
    <div className="recipients-section">
      <div className="section-header">
        <Users size={18} />
        <h3>
          Recipients ({displayedRecipients.length}
          {!showFullList && ` of ${recipients.length}`})
        </h3>
        {showFullList ? (
          <Eye size={16} className="visibility-icon" />
        ) : (
          <EyeOff size={16} className="visibility-icon" />
        )}
      </div>

      <div className="recipients-list">
        {displayedRecipients.map((recipient, index) => {
          // ✅ UPDATED: Handle both basis points and percentage
          const percentage = recipient.percentage || (recipient.basisPoints ? recipient.basisPoints / 100 : 0);
          const allocation = (BigInt(totalAmount) * BigInt(Math.floor(percentage * 100))) / 10000n;
          const isCurrentUser = userRole.recipientIndex === index && userRole.isRecipient;
          
          return (
            <div 
              key={recipient.wallet} 
              className={`recipient-card ${isCurrentUser ? 'current-user' : ''}`}
            >
              <div className="recipient-header">
                <div className="recipient-address">
                  {showFullList ? formatAddress(recipient.wallet) : 'Your Address'}
                </div>
                {isCurrentUser && <span className="user-badge">You</span>}
              </div>
              
              <div className="recipient-details">
                <div className="detail-row">
                  <span className="label">Allocation:</span>
                  <span className="value">{percentage.toFixed(2)}%</span>
                </div>
                {recipient.basisPoints && (
                  <div className="detail-row">
                    <span className="label">Basis Points:</span>
                    <span className="value">{recipient.basisPoints}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">Amount:</span>
                  <span className="value">
                    {formatTokenAmount(allocation.toString())} tokens
                  </span>
                </div>
                {recipient.claimedAmount && (
                  <div className="detail-row">
                    <span className="label">Claimed:</span>
                    <span className="value">
                      {formatTokenAmount(recipient.claimedAmount)} tokens
                    </span>
                  </div>
                )}
                {recipient.lastClaimTime && recipient.lastClaimTime > 0 && (
                  <div className="detail-row">
                    <span className="label">Last Claim:</span>
                    <span className="value">
                      {new Date(recipient.lastClaimTime * 1000).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};