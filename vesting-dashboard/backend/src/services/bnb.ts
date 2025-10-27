// backend/src/services/bnb.ts
import { ethers } from 'ethers';
import { ClaimResponse, UserPermission, VestingRecipient } from '../types';
import { BNB_VESTING_ABI, getContractConfig, KNOWN_ADDRESSES } from '../config/contracts';
import { isAddressEqual } from '../utils/validation';
import { logger } from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';

export class BNBService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private config: ReturnType<typeof getContractConfig>['bnb'];

  constructor() {
    this.config = getContractConfig().bnb;
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
    this.contract = new ethers.Contract(
      this.config.contractAddress,
      BNB_VESTING_ABI,
      this.wallet
    );
  }

  async verifyUserPermission(
    userAddress: string,
    beneficiaryAddress: string
  ): Promise<UserPermission> {
    try {
      logger.debug('Verifying user permission', {
        userAddress,
        beneficiaryAddress,
        initializer: KNOWN_ADDRESSES.initializer
      });

      // Check if user is the initializer
      if (isAddressEqual(userAddress, KNOWN_ADDRESSES.initializer, 'bnb')) {
        return {
          allowed: true,
          role: 'initializer'
        };
      }

      // Check if user is a recipient
      const recipients = await this.contract.getRecipients(beneficiaryAddress);
      
      for (let i = 0; i < recipients.length; i++) {
        if (isAddressEqual(userAddress, recipients[i].wallet, 'bnb')) {
          return {
            allowed: true,
            role: 'recipient',
            recipientIndex: i
          };
        }
      }

      return {
        allowed: false,
        role: 'none'
      };

    } catch (error) {
      logger.error('Error verifying user permission', { error, userAddress, beneficiaryAddress });
      return {
        allowed: false,
        role: 'none'
      };
    }
  }

  async getVestingInfo(beneficiaryAddress: string) {
    try {
      const [schedule, claimableAmount, recipients] = await Promise.all([
        this.contract.getVestingSchedule(beneficiaryAddress),
        this.contract.getClaimableAmount(beneficiaryAddress),
        this.contract.getRecipients(beneficiaryAddress)
      ]);

      return {
        schedule,
        claimableAmount,
        recipients: recipients.map((r: any) => ({
          wallet: r.wallet,
          basisPoints: Number(r.basisPoints),
          percentage: Number(r.basisPoints) / 100  // Convert basis points to percentage
        }))
      };
    } catch (error) {
      logger.error('Error getting vesting info', { error, beneficiaryAddress });
      throw error;
    }
  }

  async getRecipientClaimInfo(beneficiaryAddress: string, recipientAddress: string) {
    try {
      const canClaim = await this.contract.canClaim(beneficiaryAddress, recipientAddress);
      const claimableAmount = await this.contract.getRecipientClaimableAmount(beneficiaryAddress, recipientAddress);
      
      return {
        canClaim,
        claimableAmount,
        recipientAddress
      };
    } catch (error) {
      logger.error('Failed to get recipient claim info', { error, beneficiaryAddress, recipientAddress });
      return {
        canClaim: false,
        claimableAmount: 0n,
        recipientAddress
      };
    }
  }

  async executeClaim(beneficiaryAddress: string, userAddress: string): Promise<ClaimResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting BNB claim execution', {
        beneficiaryAddress,
        userAddress
      });

      // Check user permissions to determine claim method
      const permission = await this.verifyUserPermission(userAddress, beneficiaryAddress);
      
      if (!permission.allowed) {
        return {
          success: false,
          error: 'User not authorized to claim for this beneficiary',
          timestamp: new Date().toISOString()
        };
      }

      // Get vesting information
      const vestingInfo = await this.getVestingInfo(beneficiaryAddress);
      
      if (vestingInfo.claimableAmount === 0n) {
        return {
          success: false,
          error: 'No tokens available to claim',
          timestamp: new Date().toISOString()
        };
      }

      // Check gas price and estimate gas
      const gasPrice = await this.provider.getFeeData();
      logger.debug('Gas estimation', {
        gasPrice: gasPrice.gasPrice?.toString(),
        maxFeePerGas: gasPrice.maxFeePerGas?.toString()
      });

      let gasEstimate: bigint;
      let tx: any;

      if (permission.role === 'initializer') {
        // ✅ RESTORED: Backend BNB distribution from beneficiary
        logger.info('Executing BNB distribution from initializer/beneficiary');
        gasEstimate = await this.contract.distributeTokens.estimateGas(beneficiaryAddress);
        tx = await this.contract.distributeTokens(beneficiaryAddress, {
          gasLimit: gasEstimate + BigInt(50000),
          gasPrice: gasPrice.gasPrice
        });

      } else if (permission.role === 'recipient') {
        // ✅ CHANGED: Recipients should use frontend direct claim, not backend
        logger.info('Recipient claim request - redirecting to frontend direct claim');
        return {
          success: false,
          error: 'Recipients should use the "Claim My Tokens" button on the website for direct MetaMask claiming. Backend claims are only for initializers.',
          timestamp: new Date().toISOString()
        };

      } else {
        return {
          success: false,
          error: 'User role not supported for claiming',
          timestamp: new Date().toISOString()
        };
      }

      logger.info('Transaction submitted', {
        txHash: tx.hash,
        gasLimit: (gasEstimate + BigInt(50000)).toString(),
        method: permission.role === 'initializer' ? 'distributeTokens' : 'claimTokens'
      });

      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Transaction failed or was reverted');
      }

      logger.info('Transaction confirmed', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString()
      });

      // Calculate distribution amounts based on role
      let distributionAmounts;
      let totalDistributed: string;

      if (permission.role === 'initializer') {
        // Initializer distributes to all recipients
        distributionAmounts = vestingInfo.recipients.map((recipient: VestingRecipient) => {
          const percentage = recipient.percentage || (recipient.basisPoints / 100);
          return {
            address: recipient.wallet,
            amount: ((vestingInfo.claimableAmount * BigInt(Math.floor(percentage))) / 100n).toString(),
            percentage: percentage
          };
        });
        totalDistributed = vestingInfo.claimableAmount.toString();
      } else {
        // Recipient gets only their share
        const recipientData = vestingInfo.recipients[permission.recipientIndex!];
        const percentage = recipientData.percentage || (recipientData.basisPoints / 100);
        const recipientShare = (vestingInfo.claimableAmount * BigInt(Math.floor(percentage))) / 100n;
        distributionAmounts = [{
          address: userAddress,
          amount: recipientShare.toString(),
          percentage: percentage
        }];
        totalDistributed = recipientShare.toString();
      }

      const executionTime = Date.now() - startTime;
      logger.info('BNB claim completed successfully', {
        executionTime: `${executionTime}ms`,
        distributedAmount: totalDistributed,
        recipientCount: distributionAmounts.length,
        role: permission.role
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        distributedAmount: totalDistributed,
        recipients: distributionAmounts,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      // Log error with full details
      ErrorHandler.logAndGetSafeError(
        error,
        'BNB claim execution',
        {
          executionTime: `${executionTime}ms`,
          beneficiaryAddress,
          userAddress
        }
      );

      // Get safe blockchain-specific error message
      const safeError = ErrorHandler.handleBlockchainError(error, 'bnb');

      return {
        success: false,
        error: safeError.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Health check for BNB service
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Check if we can connect to the provider
      const blockNumber = await this.provider.getBlockNumber();
      
      // Check if our wallet has some balance for gas
      const balance = await this.provider.getBalance(this.wallet.address);
      
      // Check if we can read from the contract
      const code = await this.provider.getCode(this.config.contractAddress);
      
      if (code === '0x') {
        return {
          healthy: false,
          error: 'Contract not found at specified address'
        };
      }

      if (balance === 0n) {
        logger.warn('Executor wallet has zero balance', {
          wallet: this.wallet.address
        });
      }

      logger.debug('BNB service health check passed', {
        blockNumber,
        walletBalance: ethers.formatEther(balance),
        contractAddress: this.config.contractAddress
      });

      return { healthy: true };

    } catch (error: any) {
      logger.error('BNB service health check failed', error);
      const safeError = ErrorHandler.logAndGetSafeError(
        error,
        'BNB service health check',
        {},
        'BNB service unavailable'
      );
      
      return {
        healthy: false,
        error: safeError.message
      };
    }
  }
}