
export type SupportedChain = 'bnb' | 'solana';


export function getTokenDecimals(chain: SupportedChain): number {
  switch (chain) {
    case 'solana':
      return 9;
    case 'bnb':
      return 18;
    default:
      return 18; 
  }
}

export function detectChainFromTokenAddress(tokenAddress: string): SupportedChain {

  if (tokenAddress && tokenAddress.startsWith('0x') && tokenAddress.length === 42) {
    return 'bnb';
  }
  
  if (tokenAddress && !tokenAddress.startsWith('0x') && tokenAddress.length >= 32) {
    return 'solana';
  }
  
  return 'bnb';
}

export function formatTokenAmount(
  amount: string, 
  chain: SupportedChain,
  customDecimals?: number,
  maxDecimals: number = 3
): string {
  try {
    if (!amount || amount === '0') return '0';
    
    const value = BigInt(amount);
    if (value === 0n) return '0';
    
    const decimals = customDecimals ?? getTokenDecimals(chain);
    const divisor = BigInt(10 ** decimals);
    const quotient = value / divisor;
    const remainder = value % divisor;
    
    if (remainder === BigInt(0)) {
      return quotient.toString();
    }
    
    const remainderStr = remainder.toString().padStart(decimals, '0');
    
    const trimmed = remainderStr.replace(/0+$/, '');
    
    if (trimmed === '') {
      return quotient.toString();
    }
    
    // Limit decimal places to maxDecimals
    const limitedDecimals = trimmed.length > maxDecimals ? trimmed.substring(0, maxDecimals) : trimmed;
    
    return `${quotient}.${limitedDecimals}`;
    
  } catch (error) {
    console.error('Error formatting token amount:', {
      amount,
      chain,
      customDecimals,
      maxDecimals,
      error: error instanceof Error ? error.message : error
    });
    return '0';
  }
}

export function formatTokenAmountByAddress(
  amount: string, 
  tokenAddress: string,
  customDecimals?: number,
  maxDecimals: number = 3
): string {
  const chain = detectChainFromTokenAddress(tokenAddress);
  return formatTokenAmount(amount, chain, customDecimals, maxDecimals);
}