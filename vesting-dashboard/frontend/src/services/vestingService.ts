// src/services/vestingService.ts - ИСПРАВЛЕННАЯ версия с новым парсером Solana
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import type { 
  VestingData, 
  VestingConfig, 
  UserRole, 
  Recipient,
  VestingSchedule,
  VestingProgress,
  ClaimStatus,
  ClaimRequest,
  ClaimResponse
} from '../types/vesting';
import { BNB_VESTING_ABI } from '../types/vesting';

// Add type definitions for contract responses
interface ContractRecipient {
  wallet: string;
  percentage: number;
}

interface ContractVestingSchedule {
  isInitialized: boolean;
  token: string;
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  totalAmount: bigint;
  claimedAmount: bigint;
  recipientCount: number;
  isTestMode: boolean;
}

interface ContractVestingProgress {
  elapsedTime: bigint;
  unlockedPercentage: bigint;
  unlockedAmount: bigint;
  claimableAmount: bigint;
  remainingAmount: bigint;
}

interface ContractNextUnlock {
  nextUnlockTime: bigint;
  nextUnlockPercentage: bigint;
  timeRemaining: bigint;
}

export class VestingService {
  private config: VestingConfig;
  private backendUrl: string;

  constructor() {
    this.backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    
    this.config = {
      bnb: {
        rpcUrl: 'https://bsc-testnet.drpc.org',
        contractAddress: import.meta.env.VITE_BNB_CONTRACT_ADDRESS || '0xEAA6c8F73116f5D08bfb90a93Ee7aAcbd1498E84',
        tokenAddress: import.meta.env.VITE_BNB_TOKEN_ADDRESS || '0xFBA837650a37138Aa4C559025E28D98698c1f082',
        name: 'BNB Smart Chain Testnet',
        explorerUrl: 'https://testnet.bscscan.com'
      },
      solana: {
        rpcUrl: 'https://api.devnet.solana.com',
        vestingPDA: import.meta.env.VITE_SOLANA_VESTING_PDA || 'BU38o4YFshs4UUidcV8AQZ6hrphmXbZy5Sqm5AcatCWz',
        programId: import.meta.env.VITE_SOLANA_PROGRAM_ID || '5Q45ww8uwWsnLpZa8ivFFp6ENfVFHE9yCARTs1CJ3xZB',
        name: 'Solana Devnet',
        explorerUrl: 'https://explorer.solana.com'
      }
    };
  }

  async fetchBNBVestingData(
    userAddress: string | null,
    provider?: ethers.BrowserProvider
  ): Promise<VestingData | null> {
    try {
      const rpcProvider = provider || new ethers.JsonRpcProvider(this.config.bnb.rpcUrl);
      const contract = new ethers.Contract(
        this.config.bnb.contractAddress,
        BNB_VESTING_ABI,
        rpcProvider
      );

      const KNOWN_INITIALIZER = '0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC';

      console.group('🔧 BNB Vesting - Contract Data Analysis');
      
      const scheduleResult = await contract.getVestingSchedule(KNOWN_INITIALIZER) as ContractVestingSchedule;
      
      if (!scheduleResult.isInitialized) {
        console.log('❌ Contract not initialized');
        console.groupEnd();
        return null;
      }

      const totalAmount = BigInt(scheduleResult.totalAmount);
      let claimedAmount = BigInt(scheduleResult.claimedAmount);
      
      try {
        const currentSchedule = await contract.getVestingSchedule(KNOWN_INITIALIZER);
        const actualClaimedAmount = BigInt(currentSchedule.claimedAmount);
        
        if (actualClaimedAmount !== claimedAmount) {
          console.log('⚠️ Claimed amount mismatch detected:', {
            fromSchedule: claimedAmount.toString(),
            actualClaimed: actualClaimedAmount.toString()
          });
          claimedAmount = actualClaimedAmount; 
        }
      } catch (error) {
        console.warn('Could not verify claimed amount:', error);
      }
      
      console.log('📊 Contract Schedule Data:', {
        totalAmount: totalAmount.toString(),
        claimedAmount: claimedAmount.toString(),
        startTime: scheduleResult.startTime > 0 ? new Date(Number(scheduleResult.startTime) * 1000).toISOString() : 'Not started'
      });

      try {
        const claimableFromContract = await contract.getClaimableAmount(KNOWN_INITIALIZER);
        const canDistribute = await contract.canDistribute(KNOWN_INITIALIZER);
        
        console.log('🔍 Additional contract checks:', {
          claimableFromContract: claimableFromContract.toString(),
          canDistribute,
          contractClaimedAmount: claimedAmount.toString()
        });
        
        if (claimableFromContract === 0n && claimedAmount < totalAmount && canDistribute === false) {
          console.log('🚨 Potential data inconsistency detected - assuming full distribution');
          claimedAmount = totalAmount; 
        }
      } catch (error) {
        console.warn('Could not perform additional contract checks:', error);
      }

      let isFullyVested = claimedAmount >= totalAmount;
      
      if (!isFullyVested) {
        const currentTime = Math.floor(Date.now() / 1000);
        const startTime = Number(scheduleResult.startTime);
        const elapsedTime = currentTime - startTime;
        const vestingEndTime = startTime + Number(scheduleResult.vestingDuration);
        
        if (currentTime >= vestingEndTime && elapsedTime > 1200) {
          console.log('🕒 Vesting period completed by time, assuming full distribution');
          isFullyVested = true;
          claimedAmount = totalAmount; 
        }
      }

      console.log('📊 Final status check:', {
        isFullyVested,
        claimedAmount: claimedAmount.toString(),
        totalAmount: totalAmount.toString()
      });

      let unlockedPercentage: number;
      let unlockedAmount: bigint;
      let claimableAmount: bigint;
      let remainingAmount: bigint;
      let currentPeriod: number;

      if (isFullyVested) {
        unlockedPercentage = 100;
        unlockedAmount = totalAmount;
        claimableAmount = 0n;  
        remainingAmount = 0n;  
        currentPeriod = 4;  
        
        console.log('✅ Vesting completed - all tokens distributed');
      } else {
        const currentTime = Math.floor(Date.now() / 1000);
        const startTime = Number(scheduleResult.startTime);
        const actualElapsed = Math.max(0, currentTime - startTime);
        
        unlockedPercentage = this.calculateUnlockedPercentageManually(actualElapsed);
        currentPeriod = this.calculateBNBCurrentPeriod(actualElapsed);
        
        unlockedAmount = (totalAmount * BigInt(unlockedPercentage)) / 100n;
        claimableAmount = unlockedAmount - claimedAmount;
        remainingAmount = totalAmount - unlockedAmount;
        
        console.log('📊 Active vesting calculation:', {
          elapsedTime: actualElapsed,
          elapsedMinutes: Math.floor(actualElapsed / 60),
          unlockedPercentage,
          currentPeriod,
          unlockedAmount: unlockedAmount.toString(),
          claimableAmount: claimableAmount.toString(),
          remainingAmount: remainingAmount.toString()
        });
      }

      const schedule: VestingSchedule = {
        isInitialized: scheduleResult.isInitialized,
        token: scheduleResult.token,
        startTime: Number(scheduleResult.startTime),
        cliffDuration: Number(scheduleResult.cliffDuration),
        vestingDuration: Number(scheduleResult.vestingDuration),
        totalAmount: scheduleResult.totalAmount.toString(),
        claimedAmount: claimedAmount.toString(),  
        recipientCount: Number(scheduleResult.recipientCount),
        isTestMode: scheduleResult.isTestMode || false
      };

      const progress: VestingProgress = {
        elapsedTime: isFullyVested ? Number(scheduleResult.vestingDuration) : Math.max(0, Math.floor(Date.now() / 1000) - Number(scheduleResult.startTime)),
        unlockedPercentage,
        unlockedAmount: unlockedAmount.toString(),
        claimableAmount: claimableAmount.toString(),
        remainingAmount: remainingAmount.toString(),
        currentPeriod,
        canClaimNow: claimableAmount > 0n
      };

      console.log('✅ Final corrected data:', {
        schedule: {
          totalAmount: schedule.totalAmount,
          claimedAmount: schedule.claimedAmount
        },
        progress: {
          unlockedPercentage: progress.unlockedPercentage,
          unlockedAmount: progress.unlockedAmount,
          claimableAmount: progress.claimableAmount,
          remainingAmount: progress.remainingAmount,
          canClaimNow: progress.canClaimNow
        }
      });
      console.groupEnd();

      const recipientsResult = await contract.getRecipients(KNOWN_INITIALIZER) as ContractRecipient[];
      const uniqueRecipients = new Map<string, Recipient>();
      
      recipientsResult.forEach((r: ContractRecipient) => {
        const wallet = r.wallet.toLowerCase();
        if (wallet !== '0x0000000000000000000000000000000000000000' && r.percentage > 0) {
          uniqueRecipients.set(wallet, {
            wallet: r.wallet,
            percentage: Number(r.percentage)
          });
        }
      });
      
      const recipients: Recipient[] = Array.from(uniqueRecipients.values());
      const userRole = this.determineUserRole(userAddress, KNOWN_INITIALIZER, recipients);
      const claimStatus = await this.calculateClaimStatus(contract, KNOWN_INITIALIZER, schedule, progress, userRole);

      return {
        schedule,
        progress,
        recipients,
        userRole,
        claimStatus
      };

    } catch (error) {
      console.error('Error fetching BNB vesting data:', error);
      console.groupEnd();
      return null;
    }
  }
  async fetchSolanaVestingData(
    userAddress: string | null,
    connection: Connection
  ): Promise<VestingData | null> {
    try {
      const vestingPDA = new PublicKey(this.config.solana.vestingPDA);
      const accountInfo = await connection.getAccountInfo(vestingPDA);
      
      if (!accountInfo) {
        console.warn('Solana vesting account not found');
        return null;
      }

      console.group('🔍 Solana Vesting - Parsing Account Data');
      console.log('Account data length:', accountInfo.data.length);

      const parsedData = this.parseNewSolanaVestingAccount(accountInfo.data);
      if (!parsedData) {
        console.error('Failed to parse Solana vesting account');
        console.groupEnd();
        return null;
      }

      console.log('✅ Parsed vesting data:', {
        isInitialized: parsedData.isInitialized,
        startTime: parsedData.startTime,
        totalAmount: parsedData.totalAmount,
        recipientCount: parsedData.recipientCount,
        recipients: parsedData.recipients.map((r: Recipient) => ({
          wallet: r.wallet.substring(0, 8) + '...',
          percentage: r.percentage,
          claimedAmount: r.claimedAmount
        }))
      });

      const currentTime = Math.floor(Date.now() / 1000);
      const progress = this.calculateSolanaProgress(parsedData, currentTime);

      console.log('✅ Calculated progress:', progress);

      const userRole = this.determineUserRole(
        userAddress, 
        parsedData.initializer, 
        parsedData.recipients
      );

      const claimStatus = this.calculateSolanaClaimStatus(parsedData, progress, userRole);

      console.groupEnd();

      return {
        schedule: {
          isInitialized: parsedData.isInitialized,
          token: parsedData.mint,
          startTime: parsedData.startTime,
          cliffDuration: parsedData.cliffPeriod,
          vestingDuration: parsedData.vestingPeriod,
          totalAmount: parsedData.totalAmount,
          claimedAmount: this.calculateTotalClaimed(parsedData.recipients),
          recipientCount: parsedData.recipientCount,
          isRevoked: parsedData.isRevoked
        },
        progress,
        recipients: parsedData.recipients,
        userRole,
        claimStatus
      };

    } catch (error) {
      console.error('Error fetching Solana vesting data:', error);
      console.groupEnd();
      return null;
    }
  }

  private parseNewSolanaVestingAccount(data: Buffer): any {
    try {
      console.log('📊 Parsing Solana account with length:', data.length);
      
      if (!data || data.length < 141) {
        console.error(`Invalid vesting account data. Length: ${data?.length || 0}, expected at least 141`);
        return null;
      }
      
      let offset = 0;

      const isInitialized = data[offset] === 1;
      offset += 1;

      const initializer = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const startTime = Number(data.readBigInt64LE(offset));
      offset += 8;

      const totalAmount = data.readBigUInt64LE(offset);
      offset += 8;

      const cliffPeriod = Number(data.readBigInt64LE(offset));
      offset += 8;

      const vestingPeriod = Number(data.readBigInt64LE(offset));
      offset += 8;

      const tgePercentage = data[offset];
      offset += 1;

      const recipientCount = data[offset];
      offset += 1;

      const isRevoked = data[offset] === 1;
      offset += 1;

      const isFinalized = data[offset] === 1;
      offset += 1;

      const lastDistributionTime = Number(data.readBigInt64LE(offset));
      offset += 8;

      console.log('📋 Basic fields parsed:', {
        isInitialized,
        initializer: initializer.toBase58(),
        startTime: startTime > 0 ? new Date(startTime * 1000).toISOString() : 'Not started',
        totalAmount: totalAmount.toString(),
        recipientCount,
        isRevoked,
        isFinalized,
        lastDistributionTime
      });

      const recipients: Recipient[] = [];
      
      console.log('👥 Parsing recipients starting at offset:', offset);
      
      for (let i = 0; i < Math.min(recipientCount, 10); i++) {
        if (offset + 49 > data.length) {
          console.warn(`Not enough data for recipient ${i}, stopping parsing`);
          break;
        }

        const wallet = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;

        const percentage = data[offset];
        offset += 1;

        const claimedAmount = data.readBigUInt64LE(offset);
        offset += 8;

        const lastClaimTime = Number(data.readBigInt64LE(offset));
        offset += 8;

        if (percentage > 0) {
          const recipient: Recipient = {
            wallet: wallet.toBase58(),
            percentage: percentage,
            claimedAmount: claimedAmount.toString(),
            lastClaimTime: lastClaimTime
          };
          
          recipients.push(recipient);
          
          console.log(`👤 Recipient ${i}:`, {
            wallet: recipient.wallet.substring(0, 8) + '...',
            percentage: recipient.percentage,
            claimedAmount: recipient.claimedAmount,
            lastClaimTime: lastClaimTime > 0 ? new Date(lastClaimTime * 1000).toISOString() : 'Never'
          });
        }
      }

      console.log('✅ Successfully parsed', recipients.length, 'recipients');

      return {
        isInitialized,
        initializer: initializer.toBase58(),
        mint: mint.toBase58(),
        vault: vault.toBase58(),
        startTime,
        totalAmount: totalAmount.toString(),
        cliffPeriod,
        vestingPeriod,
        tgePercentage,
        recipients,
        recipientCount,
        isRevoked,
        isFinalized,
        lastDistributionTime
      };

    } catch (error) {
      console.error('Error parsing new Solana vesting account:', error);
      return null;
    }
  }

  private calculateUnlockedPercentageManually(elapsedTime: number): number {
    const totalMinutes = Math.floor(elapsedTime / 60);
    
    if (totalMinutes < 5) {
      return 0;
    } else if (totalMinutes < 10) {
      return 10;
    } else if (totalMinutes < 15) {
      return 20;
    } else if (totalMinutes < 20) {
      return 50;
    } else {
      return 100;
    }
  }

  private calculateBNBCurrentPeriod(elapsedTime: number): number {
    if (elapsedTime < 0) return 0;
    
    const totalMinutes = Math.floor(elapsedTime / 60);
    
    if (totalMinutes < 5) {
      return 0;
    } else if (totalMinutes < 10) {
      return 1;
    } else if (totalMinutes < 15) {
      return 2;
    } else if (totalMinutes < 20) {
      return 3;
    } else {
      return 4;
    }
  }

  private calculateSolanaProgress(vestingData: any, currentTime: number): VestingProgress {
    const elapsedTime = Math.max(0, currentTime - vestingData.startTime);
    let unlockedPercentage = 0;
    let currentPeriod = 0;

    if (vestingData.startTime > 0) {
      if (elapsedTime < 300) {        
        unlockedPercentage = 10;
        currentPeriod = 1;
      } else if (elapsedTime < 600) { 
        unlockedPercentage = 20;
        currentPeriod = 2;
      } else if (elapsedTime < 900) { 
        unlockedPercentage = 50;
        currentPeriod = 3;
      } else {                        
        unlockedPercentage = 100;
        currentPeriod = 4;
      }
    }

    const totalAmount = BigInt(vestingData.totalAmount);
    const unlockedAmount = (totalAmount * BigInt(unlockedPercentage)) / 100n;
    
    const totalClaimed = vestingData.recipients.reduce((sum: bigint, recipient: Recipient) => {
      return sum + BigInt(recipient.claimedAmount || '0');
    }, 0n);
    
    const claimableAmount = unlockedAmount - totalClaimed;
    const remainingAmount = totalAmount - unlockedAmount;

    console.log('📊 Progress calculation:', {
      elapsedTime,
      elapsedMinutes: Math.floor(elapsedTime / 60),
      unlockedPercentage,
      totalAmount: totalAmount.toString(),
      unlockedAmount: unlockedAmount.toString(),
      totalClaimed: totalClaimed.toString(),
      claimableAmount: claimableAmount.toString(),
      remainingAmount: remainingAmount.toString()
    });

    return {
      elapsedTime,
      unlockedPercentage,
      unlockedAmount: unlockedAmount.toString(),
      claimableAmount: claimableAmount > 0n ? claimableAmount.toString() : '0',
      remainingAmount: remainingAmount.toString(),
      currentPeriod,
      canClaimNow: claimableAmount > 0n
    };
  }

  async requestClaim(request: ClaimRequest): Promise<ClaimResponse> {
    try {
      console.log('Sending claim request to backend:', request);
      
      const response = await fetch(`${this.backendUrl}/api/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Backend claim request failed:', data);
        return {
          success: false,
          error: data.error || `HTTP error! status: ${response.status}`
        };
      }

      console.log('Backend claim response:', data);
      return data;

    } catch (error) {
      console.error('Claim request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error - could not connect to backend'
      };
    }
  }

  async checkBackendHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.backendUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          error: `Backend returned ${response.status}`
        };
      }

      const data = await response.json();
      return {
        healthy: data.status === 'healthy',
        error: data.status !== 'healthy' ? 'Backend reports unhealthy status' : undefined
      };

    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Could not connect to backend'
      };
    }
  }

  async checkClaimStatus(
    chain: 'bnb' | 'solana',
    beneficiaryAddress: string,
    userAddress: string
  ): Promise<{
    canClaim: boolean;
    claimableAmount: string;
    userRole: string;
    authorized: boolean;
  }> {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/claim/status/${chain}/${beneficiaryAddress}?user=${encodeURIComponent(userAddress)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('Failed to check claim status:', error);
      return {
        canClaim: false,
        claimableAmount: '0',
        userRole: 'none',
        authorized: false
      };
    }
  }

  private determineUserRole(
    userAddress: string | null,
    initializerAddress: string,
    recipients: Recipient[]
  ): UserRole {
    if (!userAddress) {
      return { isInitializer: false, isRecipient: false };
    }

    const isInitializer = userAddress.toLowerCase() === initializerAddress.toLowerCase();
    
    const recipientIndex = recipients.findIndex((r: Recipient) => 
      r.wallet.toLowerCase() === userAddress.toLowerCase()
    );
    
    const isRecipient = recipientIndex !== -1;
    
    return {
      isInitializer,
      isRecipient,
      recipientIndex: isRecipient ? recipientIndex : undefined,
      recipientData: isRecipient ? recipients[recipientIndex] : undefined
    };
  }

  private async calculateClaimStatus(
    contract: ethers.Contract,
    beneficiary: string,
    schedule: VestingSchedule,
    progress: VestingProgress,
    userRole: UserRole
  ): Promise<ClaimStatus> {
    try {
      const canClaim = progress.canClaimNow && (userRole.isInitializer || userRole.isRecipient);
      
      if (canClaim) {
        return {
          canClaim: true,
          reason: 'Tokens available for claim'
        };
      }

      try {
        const nextUnlock = await contract.getNextUnlock(beneficiary) as ContractNextUnlock;
        return {
          canClaim: false,
          nextUnlockTime: Number(nextUnlock.nextUnlockTime),
          nextUnlockPercentage: Number(nextUnlock.nextUnlockPercentage),
          timeRemaining: Number(nextUnlock.timeRemaining),
          reason: `Next unlock in ${Math.ceil(Number(nextUnlock.timeRemaining) / 60)} minutes`
        };
      } catch {
        const currentTime = Math.floor(Date.now() / 1000);
        const timeSinceStart = currentTime - schedule.startTime;
        
        if (schedule.startTime === 0) {
          return {
            canClaim: false,
            reason: 'Vesting not funded yet'
          };
        }
        
        if (timeSinceStart < schedule.cliffDuration) {
          const timeRemaining = schedule.cliffDuration - timeSinceStart;
          return {
            canClaim: false,
            timeRemaining,
            reason: `Still in cliff period (${Math.ceil(timeRemaining / 60)} minutes remaining)`
          };
        }

        return {
          canClaim: false,
          reason: 'No tokens available to claim'
        };
      }
    } catch (error) {
      return {
        canClaim: false,
        reason: 'Error calculating claim status'
      };
    }
  }

  private calculateSolanaClaimStatus(vestingData: any, progress: VestingProgress, userRole: UserRole): ClaimStatus {
    if (vestingData.isRevoked) {
      return {
        canClaim: false,
        reason: 'Vesting has been revoked'
      };
    }

    if (vestingData.startTime === 0) {
      return {
        canClaim: false,
        reason: 'Vesting not funded yet'
      };
    }

    const canClaim = progress.canClaimNow && (userRole.isInitializer || userRole.isRecipient);
    
    if (canClaim) {
      return {
        canClaim: true,
        reason: 'Tokens available for claim'
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const elapsedTime = currentTime - vestingData.startTime;
    
    const unlockTimes = [
      { time: 300, percentage: 20 },
      { time: 600, percentage: 50 },
      { time: 900, percentage: 100 }
    ];

    for (const unlock of unlockTimes) {
      if (elapsedTime < unlock.time) {
        const timeRemaining = unlock.time - elapsedTime;
        return {
          canClaim: false,
          nextUnlockTime: vestingData.startTime + unlock.time,
          nextUnlockPercentage: unlock.percentage,
          timeRemaining,
          reason: `Next unlock (${unlock.percentage}%) in ${Math.ceil(timeRemaining / 60)} minutes`
        };
      }
    }

    return {
      canClaim: false,
      reason: 'All tokens have been unlocked'
    };
  }

  private calculateTotalClaimed(recipients: Recipient[]): string {
    return recipients.reduce((total, recipient: Recipient) => {
      return total + BigInt(recipient.claimedAmount || '0');
    }, 0n).toString();
  }

  formatTokenAmount(amount: string, decimals: number = 9): string {
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
        return `${quotient}.${trimmed}`;
      }
    } catch (error) {
      return '0';
    }
  }

  formatDuration(seconds: number): string {
    if (seconds <= 0) return 'No cliff';
    
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  getExplorerUrl(chain: 'bnb' | 'solana', hash: string): string {
    if (chain === 'bnb') {
      return `${this.config.bnb.explorerUrl}/tx/${hash}`;
    } else {
      return `${this.config.solana.explorerUrl}/tx/${hash}?cluster=devnet`;
    }
  }
}