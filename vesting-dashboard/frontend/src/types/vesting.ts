
export type SupportedChain = 'bnb' | 'solana';

export interface VestingConfig {
  bnb: {
    rpcUrl: string;
    contractAddress: string;
    tokenAddress: string;
    name: string;
    explorerUrl: string;
  };
  solana: {
    rpcUrl: string;
    vestingPDA: string;
    programId: string;
    name: string;
    explorerUrl: string;
  };
}

export interface Recipient {
  wallet: string;
  percentage: number;
  claimedAmount?: string;
  lastClaimTime?: number;
}

export interface VestingSchedule {
  isInitialized: boolean;
  token: string;
  startTime: number;
  cliffDuration: number;
  vestingDuration: number;
  totalAmount: string;
  claimedAmount: string;
  recipientCount: number;
  isTestMode?: boolean;
  isRevoked?: boolean;
}

export interface VestingProgress {
  elapsedTime: number;
  unlockedPercentage: number;
  unlockedAmount: string;
  claimableAmount: string;
  remainingAmount: string;
  currentPeriod: number;
  canClaimNow: boolean;
}

export interface UserRole {
  isInitializer: boolean;
  isRecipient: boolean;
  recipientIndex?: number;
  recipientData?: Recipient;
}

export interface ClaimStatus {
  canClaim: boolean;
  nextUnlockTime?: number;
  nextUnlockPercentage?: number;
  timeRemaining?: number;
  reason?: string;
}

export interface VestingData {
  schedule: VestingSchedule;
  progress: VestingProgress;
  recipients: Recipient[];
  userRole: UserRole;
  claimStatus: ClaimStatus;
}

// API Types for secure claiming
export interface ClaimRequest {
  beneficiaryAddress: string;
  chain: 'bnb' | 'solana';
  signature?: string;
  userAddress?: string; 
}

export interface ClaimResponse {
  success: boolean;
  transactionHash?: string;
  error?: string;
  distributedAmount?: string;
  recipients?: Array<{
    address: string;
    amount: string;
  }>;
}

export const BNB_VESTING_ABI = [
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getVestingSchedule",
    "outputs": [
      {"name": "isInitialized", "type": "bool"},
      {"name": "token", "type": "address"},
      {"name": "startTime", "type": "uint256"},
      {"name": "cliffDuration", "type": "uint256"},
      {"name": "vestingDuration", "type": "uint256"},
      {"name": "totalAmount", "type": "uint256"},
      {"name": "claimedAmount", "type": "uint256"},
      {"name": "recipientCount", "type": "uint8"},
      {"name": "isTestMode", "type": "bool"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getVestingProgress",
    "outputs": [
      {"name": "elapsedTime", "type": "uint256"},
      {"name": "unlockedPercentage", "type": "uint256"},
      {"name": "unlockedAmount", "type": "uint256"},
      {"name": "claimableAmount", "type": "uint256"},
      {"name": "remainingAmount", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getRecipients",
    "outputs": [
      {
        "components": [
          {"name": "wallet", "type": "address"},
          {"name": "percentage", "type": "uint8"}
        ],
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getClaimableAmount",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getNextUnlock",
    "outputs": [
      {"name": "nextUnlockTime", "type": "uint256"},
      {"name": "nextUnlockPercentage", "type": "uint256"},
      {"name": "timeRemaining", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "_elapsedTime", "type": "uint256"},
      {"name": "_cliffDuration", "type": "uint256"},
      {"name": "_vestingDuration", "type": "uint256"}
    ],
    "name": "getUnlockedPercentage",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [{"name": "_beneficiary", "type": "address"}],
    "name": "getCurrentPeriod",
    "outputs": [{"name": "", "type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCurrentTime",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;