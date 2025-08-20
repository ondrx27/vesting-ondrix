// backend/src/config/contracts.ts - Исправленная версия
import { ContractConfig } from '../types';

export function getContractConfig(): ContractConfig {
  // Validate required environment variables
  const requiredEnvVars = [
    'BNB_RPC_URL',
    'BNB_CONTRACT_ADDRESS', 
    'BNB_PRIVATE_KEY',
    'SOLANA_RPC_URL',
    'SOLANA_PROGRAM_ID',
    'SOLANA_PRIVATE_KEY'
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // TypeScript теперь знает, что эти переменные существуют
  const bnbRpcUrl = process.env.BNB_RPC_URL;
  const bnbContractAddress = process.env.BNB_CONTRACT_ADDRESS;
  const bnbPrivateKey = process.env.BNB_PRIVATE_KEY;
  const solanaRpcUrl = process.env.SOLANA_RPC_URL;
  const solanaProgramId = process.env.SOLANA_PROGRAM_ID;
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!bnbRpcUrl || !bnbContractAddress || !bnbPrivateKey || 
      !solanaRpcUrl || !solanaProgramId || !solanaPrivateKey) {
    throw new Error('Required environment variables are not set');
  }

  return {
    bnb: {
      rpcUrl: bnbRpcUrl,
      contractAddress: bnbContractAddress,
      chainId: parseInt(process.env.BNB_CHAIN_ID || '97'),
      privateKey: bnbPrivateKey,
    },
    solana: {
      rpcUrl: solanaRpcUrl,
      programId: solanaProgramId,
      privateKey: solanaPrivateKey,
    }
  };
}

// BNB Contract ABI - minimal for claiming
export const BNB_VESTING_ABI = [
  {
    "inputs": [],
    "name": "claimTokens",
    "outputs": [],
    "stateMutability": "nonpayable",
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
  }
] as const;

export const KNOWN_ADDRESSES = {
  initializer: process.env.KNOWN_INITIALIZER || '0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC',
  // Add more known addresses as needed
};