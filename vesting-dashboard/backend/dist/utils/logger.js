"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }
    shouldLog(level) {
        const levels = ['error', 'warn', 'info', 'debug'];
        const currentLevelIndex = levels.indexOf(this.logLevel);
        const requestedLevelIndex = levels.indexOf(level);
        return requestedLevelIndex <= currentLevelIndex;
    }
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        if (data) {
            return `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
        }
        return `${prefix} ${message}`;
    }
    error(message, data) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, data));
        }
    }
    warn(message, data) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, data));
        }
    }
    info(message, data) {
        if (this.shouldLog('info')) {
            console.info(this.formatMessage('info', message, data));
        }
    }
    debug(message, data) {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage('debug', message, data));
        }
    }
    auditLog(auditData) {
        const auditMessage = this.formatMessage('audit', 'Security Event', auditData);
        console.log(auditMessage);
    }
    logClaimAttempt(data) {
        const auditLog = {
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
exports.Logger = Logger;
exports.logger = new Logger();
