
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
  basisPoints: number;  // ✅ UPDATED: Use basis points instead of percentage
  percentage?: number;  // ✅ LEGACY: Keep for backwards compatibility
  claimedAmount?: string;
  lastClaimTime?: number;
}

export interface VestingSchedule {
  chain?: 'bnb' | 'solana';  // ✅ ADD: Chain identifier to handle different logic
  isInitialized: boolean;
  token: string;
  startTime: number;
  cliffDuration: number;
  vestingDuration: number;
  totalAmount: string;
  claimedAmount: string;
  recipientCount: number;
  tgeBasisPoints?: number;  // ✅ UPDATED: TGE in basis points (Solana only)
  tgePercentage?: number;   // ✅ LEGACY: Keep for backwards compatibility (Solana only)
  isTestMode?: boolean;
  isFinalized?: boolean;    // ✅ UPDATED: New field from contract
  lastDistributionTime?: number;  // ✅ UPDATED: New field from contract
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
  amount?: string;
  recipients?: Array<{
    address: string;
    amount: string;
  }>;
}

export const BNB_VESTING_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "getVestingSchedule",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isInitialized",
        "type": "bool"
      },
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "authorizedFunder",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "startTime",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "cliffDuration",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "vestingDuration",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "claimedAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "recipientCount",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "getRecipients",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "wallet",
            "type": "address"
          },
          {
            "internalType": "uint16",
            "name": "basisPoints",
            "type": "uint16"
          },
          {
            "internalType": "uint256",
            "name": "claimedAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastClaimTime",
            "type": "uint256"
          }
        ],
        "internalType": "struct ProductionTokenVesting.Recipient[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "getClaimableAmount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "canDistribute",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "getVestingProgress",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "elapsedTime",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "unlockedPercentage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "unlockedAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "claimableAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remainingAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_recipient",
        "type": "address"
      }
    ],
    "name": "canClaim",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_recipient",
        "type": "address"
      }
    ],
    "name": "getRecipientClaimableAmount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_beneficiary",
        "type": "address"
      }
    ],
    "name": "claimTokens",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;