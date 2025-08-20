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
    percentage: number;
  }>;
  timestamp: string;
}

export interface UserPermission {
  allowed: boolean;
  role: 'initializer' | 'recipient' | 'none';
  recipientIndex?: number;
}

export interface VestingRecipient {
  wallet: string;
  percentage: number;
}

export interface ContractConfig {
  bnb: {
    rpcUrl: string;
    contractAddress: string;
    chainId: number;
    privateKey: string;
  };
  solana: {
    rpcUrl: string;
    programId: string;
    privateKey: string;
  };
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface AuditLog {
  timestamp: string;
  userAddress: string;
  beneficiaryAddress: string;
  chain: 'bnb' | 'solana';
  action: 'claim_attempt' | 'claim_success' | 'claim_failed';
  role: string;
  transactionHash?: string;
  error?: string;
  distributedAmount?: string;
  ipAddress?: string;
}