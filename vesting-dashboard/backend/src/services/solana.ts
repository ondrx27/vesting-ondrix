import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_CLOCK_PUBKEY,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import { ClaimResponse, UserPermission } from '../types';
import { getContractConfig } from '../config/contracts';
import { isAddressEqual } from '../utils/validation';
import { logger } from '../utils/logger';

interface SolanaRecipient {
  wallet: string;
  percentage: number;
  claimedAmount: string;
  lastClaimTime: number;
}

interface SolanaVestingData {
  isInitialized: boolean;
  initializer: string;
  mint: string;
  vault: string;
  startTime: number;
  totalAmount: string;
  cliffPeriod: number;
  vestingPeriod: number;
  tgePercentage: number;
  recipients: SolanaRecipient[];
  recipientCount: number;
  isRevoked: boolean;
}

export class SolanaService {
  private connection: Connection;
  private keypair: Keypair;
  private programId: PublicKey;
  private config: ReturnType<typeof getContractConfig>['solana'];

  constructor() {
    this.config = getContractConfig().solana;
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');
    
    const keyArray = JSON.parse(this.config.privateKey);
    this.keypair = Keypair.fromSecretKey(Uint8Array.from(keyArray));
    this.programId = new PublicKey(this.config.programId);
  }

  async verifyUserPermission(
    userAddress: string,
    vestingPDA: string
  ): Promise<UserPermission> {
    try {
      logger.debug('Verifying Solana user permission', {
        userAddress,
        vestingPDA
      });

      const vestingAccount = await this.getVestingAccountData(vestingPDA);
      
      if (!vestingAccount) {
        return { allowed: false, role: 'none' };
      }

      if (isAddressEqual(userAddress, vestingAccount.initializer, 'solana')) {
        return {
          allowed: true,
          role: 'initializer'
        };
      }

      for (let i = 0; i < vestingAccount.recipients.length; i++) {
        if (isAddressEqual(userAddress, vestingAccount.recipients[i].wallet, 'solana')) {
          return {
            allowed: true,
            role: 'recipient',
            recipientIndex: i
          };
        }
      }

      return { allowed: false, role: 'none' };

    } catch (error) {
      logger.error('Error verifying Solana user permission', { error, userAddress, vestingPDA });
      return { allowed: false, role: 'none' };
    }
  }

  private async getVestingAccountData(vestingPDA: string): Promise<SolanaVestingData | null> {
    try {
      const publicKey = new PublicKey(vestingPDA);
      const accountInfo = await this.connection.getAccountInfo(publicKey);
      
      if (!accountInfo) {
        return null;
      }

      return this.parseVestingAccount(accountInfo.data);
    } catch (error) {
      logger.error('Error getting vesting account data', { error, vestingPDA });
      return null;
    }
  }

  private parseVestingAccount(data: Buffer): SolanaVestingData | null {
    try {
      if (data.length < 200) {
        throw new Error('Invalid account data length');
      }

      let offset = 0;
      
      const isInitialized = data[offset] !== 0;
      offset += 1;
      
      const initializer = new PublicKey(data.slice(offset, offset + 32)).toString();
      offset += 32;
      
      const mint = new PublicKey(data.slice(offset, offset + 32)).toString();
      offset += 32;
      
      const vault = new PublicKey(data.slice(offset, offset + 32)).toString();
      offset += 32;
      
      const startTime = Number(this.readInt64LE(data, offset));
      offset += 8;
      
      const totalAmount = this.readUint64LE(data, offset);
      offset += 8;
      
      const cliffPeriod = Number(this.readInt64LE(data, offset));
      offset += 8;
      
      const vestingPeriod = Number(this.readInt64LE(data, offset));
      offset += 8;
      
      const tgePercentage = data[offset];
      offset += 1;
      
      const recipientCount = data[offset];
      offset += 1;
      
      const isRevoked = data[offset] !== 0;
      offset += 1;

      const recipients: SolanaRecipient[] = [];
      for (let i = 0; i < Math.min(recipientCount, 10); i++) {
        const wallet = new PublicKey(data.slice(offset, offset + 32)).toString();
        offset += 32;
        
        const percentage = data[offset];
        offset += 1;
        
        const claimedAmount = this.readUint64LE(data, offset);
        offset += 8;
        
        const lastClaimTime = Number(this.readInt64LE(data, offset));
        offset += 8;

        if (percentage > 0) {
          recipients.push({
            wallet,
            percentage,
            claimedAmount: claimedAmount.toString(),
            lastClaimTime
          });
        }
      }

      return {
        isInitialized,
        initializer,
        mint,
        vault,
        startTime,
        totalAmount: totalAmount.toString(),
        cliffPeriod,
        vestingPeriod,
        tgePercentage,
        recipients,
        recipientCount,
        isRevoked
      };

    } catch (error) {
      logger.error('Error parsing Solana vesting account', error);
      return null;
    }
  }

  private readUint64LE(buffer: Buffer, offset: number): bigint {
    const low = buffer.readUInt32LE(offset);
    const high = buffer.readUInt32LE(offset + 4);
    return BigInt(low) + (BigInt(high) << 32n);
  }

  private readInt64LE(buffer: Buffer, offset: number): bigint {
    const value = this.readUint64LE(buffer, offset);
    if (value >= 0x8000000000000000n) {
      return value - 0x10000000000000000n;
    }
    return value;
  }

  private calculateVestedAmount(totalAmount: bigint, elapsedSeconds: number): bigint {
    let percentage: number;
    if (elapsedSeconds < 0) {
      percentage = 0;
    } else if (elapsedSeconds < 300) { 
      percentage = 10;
    } else if (elapsedSeconds < 600) { 
      percentage = 20;
    } else if (elapsedSeconds < 900) { 
      percentage = 50;
    } else {  
      percentage = 100;
    }
    
    return (totalAmount * BigInt(percentage)) / 100n;
  }

  async executeClaim(vestingPDA: string, userAddress: string): Promise<ClaimResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting Solana claim execution', {
        vestingPDA,
        userAddress
      });

      const vestingData = await this.getVestingAccountData(vestingPDA);
      
      if (!vestingData) {
        return {
          success: false,
          error: 'Vesting account not found',
          timestamp: new Date().toISOString()
        };
      }

      if (vestingData.isRevoked) {
        return {
          success: false,
          error: 'Vesting has been revoked',
          timestamp: new Date().toISOString()
        };
      }

      if (vestingData.startTime === 0) {
        return {
          success: false,
          error: 'Vesting not funded yet',
          timestamp: new Date().toISOString()
        };
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const elapsedTime = currentTime - vestingData.startTime;
      
      const totalAmount = BigInt(vestingData.totalAmount);
      const vestedAmount = this.calculateVestedAmount(totalAmount, elapsedTime);
      
      const totalClaimed = vestingData.recipients.reduce((sum: bigint, recipient: SolanaRecipient) => {
        return sum + BigInt(recipient.claimedAmount);
      }, 0n);
      
      const claimableAmount = vestedAmount - totalClaimed;
      
      if (claimableAmount <= 0n) {
        return {
          success: false,
          error: 'No tokens available to claim at this time',
          timestamp: new Date().toISOString()
        };
      }

      logger.info('Claimable amount calculated', {
        vestedAmount: vestedAmount.toString(),
        totalClaimed: totalClaimed.toString(),
        claimableAmount: claimableAmount.toString()
      });

      const transaction = new Transaction();
      
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
      );

      const mintPubkey = new PublicKey(vestingData.mint);
      const vestingPubkey = new PublicKey(vestingPDA);
      const vaultPubkey = new PublicKey(vestingData.vault);

      const recipientATAs: PublicKey[] = [];
      for (const recipient of vestingData.recipients) {
        const recipientPubkey = new PublicKey(recipient.wallet);
        const ata = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);
        recipientATAs.push(ata);

        try {
          await getAccount(this.connection, ata);
          logger.debug(`ATA exists for ${recipient.wallet}`);
        } catch {
          logger.info(`Creating ATA for ${recipient.wallet}`);
          transaction.add(
            createAssociatedTokenAccountInstruction(
              this.keypair.publicKey,
              ata,
              recipientPubkey,
              mintPubkey
            )
          );
        }
      }

      const [vaultAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('authority'), vestingPubkey.toBuffer()],
        this.programId
      );

      const claimInstruction = new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: vestingPubkey, isSigner: false, isWritable: true },
          { pubkey: vaultPubkey, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: vaultAuthority, isSigner: false, isWritable: false },
          ...recipientATAs.map((ata: PublicKey) => ({ 
            pubkey: ata, 
            isSigner: false, 
            isWritable: true 
          }))
        ],
        data: Buffer.from([2]) 
      });

      transaction.add(claimInstruction);

      logger.info('Sending Solana transaction');
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.keypair],
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed',
        }
      );

      logger.info('Solana transaction confirmed', {
        signature,
        slot: await this.connection.getSlot()
      });

      const distributionAmounts = vestingData.recipients.map((recipient: SolanaRecipient) => {
        const share = (claimableAmount * BigInt(recipient.percentage)) / 100n;
        return {
          address: recipient.wallet,
          amount: share.toString(),
          percentage: recipient.percentage
        };
      });

      const executionTime = Date.now() - startTime;
      logger.info('Solana claim completed successfully', {
        executionTime: `${executionTime}ms`,
        distributedAmount: claimableAmount.toString(),
        recipientCount: vestingData.recipients.length
      });

      return {
        success: true,
        transactionHash: signature,
        distributedAmount: claimableAmount.toString(),
        recipients: distributionAmounts,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      logger.error('Solana claim execution failed', {
        error: error.message,
        executionTime: `${executionTime}ms`,
        vestingPDA,
        userAddress
      });

      let errorMessage = 'Failed to execute Solana claim transaction';
      
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient SOL for transaction fees';
      } else if (error.message.includes('0x1')) {
        errorMessage = 'Insufficient account balance';
      } else if (error.message.includes('0x0')) {
        errorMessage = 'Transaction instruction failed';
      } else if (error.logs) {
        logger.error('Transaction logs', { logs: error.logs });
        errorMessage = 'Transaction failed - check program state';
      }

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const slot = await this.connection.getSlot();
      
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      
      if (balance === 0) {
        logger.warn('Executor keypair has zero balance', {
          publicKey: this.keypair.publicKey.toString()
        });
      }

      logger.debug('Solana service health check passed', {
        slot,
        balance: balance / 1e9, 
        publicKey: this.keypair.publicKey.toString()
      });

      return { healthy: true };

    } catch (error: any) {
      logger.error('Solana service health check failed', error);
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}