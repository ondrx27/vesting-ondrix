import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { ClaimRequest, ValidationError } from '../types';
import { InputSanitizer } from './sanitization';

export function validateClaimRequest(req: ClaimRequest): ValidationError[] {
  const errors: ValidationError[] = [];

  // Sanitize and validate beneficiaryAddress
  if (!req.beneficiaryAddress) {
    errors.push({
      field: 'beneficiaryAddress',
      message: 'Beneficiary address is required'
    });
  } else {
    try {
      const sanitizedAddress = InputSanitizer.sanitizeAddress(req.beneficiaryAddress);
      if (!isValidAddress(sanitizedAddress, req.chain)) {
        errors.push({
          field: 'beneficiaryAddress',
          message: `Invalid ${req.chain} address format`
        });
      } else {
        // Update the request with sanitized value
        req.beneficiaryAddress = sanitizedAddress;
      }
    } catch (sanitizeError: any) {
      errors.push({
        field: 'beneficiaryAddress',
        message: `Invalid beneficiary address: ${sanitizeError.message}`
      });
    }
  }

  // Sanitize and validate chain
  if (!req.chain) {
    errors.push({
      field: 'chain',
      message: 'Chain is required'
    });
  } else {
    try {
      req.chain = InputSanitizer.sanitizeChain(req.chain);
    } catch (sanitizeError: any) {
      errors.push({
        field: 'chain',
        message: sanitizeError.message
      });
    }
  }

  // Sanitize and validate userAddress if provided
  if (req.userAddress) {
    try {
      const sanitizedUserAddress = InputSanitizer.sanitizeAddress(req.userAddress);
      if (!isValidAddress(sanitizedUserAddress, req.chain)) {
        errors.push({
          field: 'userAddress',
          message: `Invalid ${req.chain} user address format`
        });
      } else {
        req.userAddress = sanitizedUserAddress;
      }
    } catch (sanitizeError: any) {
      errors.push({
        field: 'userAddress',
        message: `Invalid user address: ${sanitizeError.message}`
      });
    }
  }

  return errors;
}

export function isValidAddress(address: string, chain: 'bnb' | 'solana'): boolean {
  try {
    if (chain === 'bnb') {
      return ethers.isAddress(address);
    } else if (chain === 'solana') {
      new PublicKey(address);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

export function sanitizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isAddressEqual(addr1: string, addr2: string, chain: 'bnb' | 'solana'): boolean {
  if (chain === 'bnb') {
    return addr1.toLowerCase() === addr2.toLowerCase();
  } else {
    return addr1 === addr2;
  }
}

export function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const requiredVars = [
    'BNB_RPC_URL',
    'BNB_CONTRACT_ADDRESS',
    'BNB_PRIVATE_KEY',
    'SOLANA_RPC_URL', 
    'SOLANA_PROGRAM_ID',
    'SOLANA_PRIVATE_KEY'
  ];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      errors.push(`Missing environment variable: ${varName}`);
    }
  }

  if (process.env.BNB_PRIVATE_KEY) {
    try {
      new ethers.Wallet(process.env.BNB_PRIVATE_KEY);
    } catch (error) {
      errors.push('Invalid BNB_PRIVATE_KEY format');
    }
  }

  if (process.env.SOLANA_PRIVATE_KEY) {
    try {
      const keyArray = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
      if (!Array.isArray(keyArray) || keyArray.length !== 64) {
        errors.push('Invalid SOLANA_PRIVATE_KEY format - must be 64-byte array');
      }
    } catch (error) {
      errors.push('Invalid SOLANA_PRIVATE_KEY format - must be valid JSON array');
    }
  }

  if (process.env.BNB_CONTRACT_ADDRESS && !ethers.isAddress(process.env.BNB_CONTRACT_ADDRESS)) {
    errors.push('Invalid BNB_CONTRACT_ADDRESS format');
  }

  if (process.env.SOLANA_PROGRAM_ID) {
    try {
      new PublicKey(process.env.SOLANA_PROGRAM_ID);
    } catch (error) {
      errors.push('Invalid SOLANA_PROGRAM_ID format');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}