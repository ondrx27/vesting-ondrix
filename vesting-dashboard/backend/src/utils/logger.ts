import { AuditLog } from '../types';

export class Logger {
  private logLevel: string;

  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);
    return requestedLevelIndex <= currentLevelIndex;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
    }
    return `${prefix} ${message}`;
  }

  error(message: string, data?: any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, data));
    }
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, data));
    }
  }

  auditLog(auditData: AuditLog): void {
    const auditMessage = this.formatMessage('audit', 'Security Event', auditData);
    console.log(auditMessage);
    
  }

  logClaimAttempt(data: {
    userAddress: string;
    beneficiaryAddress: string;
    chain: 'bnb' | 'solana';
    success: boolean;
    role: string;
    error?: string;
    transactionHash?: string;
    distributedAmount?: string;
    ipAddress?: string;
  }): void {
    const auditLog: AuditLog = {
      timestamp: new Date().toISOString(),
      userAddress: data.userAddress,
      beneficiaryAddress: data.beneficiaryAddress,
      chain: data.chain,
      action: data.success ? 'claim_success' : 'claim_failed',
      role: data.role,
      transactionHash: data.transactionHash,
      error: data.error,
      distributedAmount: data.distributedAmount,
      ipAddress: data.ipAddress
    };

    this.auditLog(auditLog);
  }
}

export const logger = new Logger();