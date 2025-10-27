// utils/errorHandler.ts - Safe error handling and message sanitization
import { logger } from './logger';
import { InputSanitizer } from './sanitization';

export interface SafeError {
  message: string;
  code?: string;
  statusCode?: number;
  timestamp: string;
}

export class ErrorHandler {
  
  // Get user-safe error message (no internal details)
  static getSafeErrorMessage(error: any, fallbackMessage: string = 'An error occurred'): string {
    // Known safe error patterns
    const safeErrors = {
      'insufficient funds': 'Insufficient funds for transaction',
      'insufficient gas': 'Insufficient gas for transaction', 
      'transaction reverted': 'Transaction failed - please try again',
      'nonce': 'Transaction timing issue - please try again',
      'network error': 'Network connection error',
      'timeout': 'Request timeout - please try again',
      'rate limit': 'Too many requests - please wait before trying again',
      'unauthorized': 'Authorization failed',
      'forbidden': 'Access denied',
      'not found': 'Resource not found',
      'validation': 'Invalid input data',
      'invalid address': 'Invalid wallet address format',
      'invalid chain': 'Unsupported blockchain network'
    };
    
    if (error && typeof error === 'object' && error.message) {
      const lowerErrorMsg = error.message.toLowerCase();
      
      // Check for known safe error patterns
      for (const [pattern, safeMsg] of Object.entries(safeErrors)) {
        if (lowerErrorMsg.includes(pattern)) {
          return safeMsg;
        }
      }
    }
    
    // Return generic fallback for unknown errors
    return fallbackMessage;
  }
  
  // Create a safe error response for APIs
  static createSafeErrorResponse(
    error: any, 
    fallbackMessage: string = 'Internal server error',
    statusCode: number = 500
  ): SafeError {
    const safeMessage = this.getSafeErrorMessage(error, fallbackMessage);
    
    return {
      message: safeMessage,
      statusCode,
      timestamp: new Date().toISOString()
    };
  }
  
  // Log error with full details while returning safe message to user
  static logAndGetSafeError(
    error: any,
    context: string,
    additionalInfo: any = {},
    fallbackMessage: string = 'Internal server error'
  ): SafeError {
    
    // Log full error details for debugging
    const logData = InputSanitizer.sanitizeLogData({
      context,
      error: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      ...additionalInfo
    });
    
    logger.error(`Error in ${context}`, logData);
    
    // Return safe error for user
    return this.createSafeErrorResponse(error, fallbackMessage);
  }
  
  // Handle blockchain-specific errors
  static handleBlockchainError(error: any, chain: 'bnb' | 'solana'): SafeError {
    const chainName = chain.toUpperCase();
    
    // Blockchain-specific error patterns
    const blockchainErrors = {
      bnb: {
        'insufficient funds': 'Insufficient BNB for gas fees',
        'revert': 'Smart contract execution failed',
        'gas': 'Gas limit exceeded',
        'nonce': 'Transaction nonce error',
        'replacement': 'Transaction replacement failed'
      },
      solana: {
        'insufficient funds': 'Insufficient SOL for transaction fees',
        '0x1': 'Insufficient account balance',
        '0x0': 'Transaction instruction failed', 
        'blockhash': 'Transaction blockhash expired',
        'signature': 'Transaction signature verification failed'
      }
    };
    
    if (error?.message) {
      const lowerErrorMsg = error.message.toLowerCase();
      const chainSpecificErrors = blockchainErrors[chain];
      
      for (const [pattern, safeMsg] of Object.entries(chainSpecificErrors)) {
        if (lowerErrorMsg.includes(pattern)) {
          return {
            message: safeMsg,
            code: `${chain.toUpperCase()}_ERROR`,
            timestamp: new Date().toISOString()
          };
        }
      }
    }
    
    return {
      message: `${chainName} transaction failed`,
      code: `${chain.toUpperCase()}_ERROR`,
      timestamp: new Date().toISOString()
    };
  }
  
  // Handle validation errors safely
  static handleValidationError(errors: any[]): SafeError {
    // Sanitize validation error messages
    const safeErrors = errors.map(err => {
      if (err.field && err.message) {
        return `${err.field}: ${InputSanitizer.sanitizeString(err.message, 100)}`;
      }
      return 'Invalid input';
    });
    
    return {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    };
  }
  
  // Check if error should be considered safe to expose
  static isSafeError(error: any): boolean {
    if (!error || typeof error !== 'object') return false;
    
    const safeErrorCodes = [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN', 
      'NOT_FOUND',
      'RATE_LIMIT_EXCEEDED',
      'INSUFFICIENT_FUNDS',
      'INVALID_ADDRESS'
    ];
    
    return safeErrorCodes.includes(error.code);
  }
  
  // Global error handler for Express
  static globalErrorHandler() {
    return (error: any, req: any, res: any, next: any) => {
      const clientIP = InputSanitizer.sanitizeIP(req.ip || 'unknown');
      const userAgent = InputSanitizer.sanitizeUserAgent(req.get('User-Agent') || 'unknown');
      
      const logData = InputSanitizer.sanitizeLogData({
        error: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        method: req.method,
        path: req.path,
        clientIP,
        userAgent: userAgent.substring(0, 100) // Truncate user agent
      });
      
      logger.error('Unhandled server error', logData);
      
      // Return safe error response
      const safeError = this.createSafeErrorResponse(error);
      
      res.status(safeError.statusCode || 500).json({
        success: false,
        error: safeError.message,
        code: safeError.code,
        timestamp: safeError.timestamp
      });
    };
  }
}

// Common error types
export const ErrorTypes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED', 
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT_EXCEEDED',
  BLOCKCHAIN_ERROR: 'BLOCKCHAIN_ERROR',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;