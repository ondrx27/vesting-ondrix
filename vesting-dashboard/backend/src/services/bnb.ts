// backend/src/services/bnb.ts
import { ethers } from 'ethers';
import { ClaimResponse, UserPermission, VestingRecipient } from '../types';
import { BNB_VESTING_ABI, getContractConfig, KNOWN_ADDRESSES } from '../config/contracts';
import { isAddressEqual } from '../utils/validation';
import { logger } from '../utils/logger';

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
          percentage: Number(r.percentage)
        }))
      };
    } catch (error) {
      logger.error('Error getting vesting info', { error, beneficiaryAddress });
      throw error;
    }
  }

  async executeClaim(beneficiaryAddress: string, userAddress: string): Promise<ClaimResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting BNB claim execution', {
        beneficiaryAddress,
        userAddress
      });

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

      // Estimate gas for the transaction
      let gasEstimate: bigint;
      try {
        gasEstimate = await this.contract.claimTokens.estimateGas();
        logger.debug('Gas estimate', { gasEstimate: gasEstimate.toString() });
      } catch (estimateError) {
        logger.error('Gas estimation failed', estimateError);
        return {
          success: false,
          error: 'Transaction would fail - please check contract state',
          timestamp: new Date().toISOString()
        };
      }

      // Execute the claim transaction
      const tx = await this.contract.claimTokens({
        gasLimit: gasEstimate + BigInt(50000), // Add buffer
        gasPrice: gasPrice.gasPrice || ethers.parseUnits('10', 'gwei')
      });

      logger.info('Transaction submitted', {
        txHash: tx.hash,
        gasLimit: (gasEstimate + BigInt(50000)).toString()
      });

      // Wait for confirmation
      const receipt = await tx.wait(1); // Wait for 1 confirmation
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Transaction failed or was reverted');
      }

      logger.info('Transaction confirmed', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString()
      });

      // Calculate distribution amounts
      const distributionAmounts = vestingInfo.recipients.map((recipient: VestingRecipient) => ({
        address: recipient.wallet,
        amount: ((vestingInfo.claimableAmount * BigInt(recipient.percentage)) / 100n).toString(),
        percentage: recipient.percentage
      }));

      const executionTime = Date.now() - startTime;
      logger.info('BNB claim completed successfully', {
        executionTime: `${executionTime}ms`,
        distributedAmount: vestingInfo.claimableAmount.toString(),
        recipientCount: vestingInfo.recipients.length
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        distributedAmount: vestingInfo.claimableAmount.toString(),
        recipients: distributionAmounts,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      logger.error('BNB claim execution failed', {
        error: error.message,
        executionTime: `${executionTime}ms`,
        beneficiaryAddress,
        userAddress
      });

      // Parse error message for user-friendly response
      let errorMessage = 'Failed to execute claim transaction';
      
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient gas funds in executor wallet';
      } else if (error.message.includes('revert')) {
        errorMessage = 'Transaction reverted - possibly no tokens to claim or contract issue';
      } else if (error.message.includes('nonce')) {
        errorMessage = 'Transaction nonce error - please try again';
      } else if (error.message.includes('gas')) {
        errorMessage = 'Gas estimation failed - transaction would likely fail';
      }

      return {
        success: false,
        error: errorMessage,
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
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}