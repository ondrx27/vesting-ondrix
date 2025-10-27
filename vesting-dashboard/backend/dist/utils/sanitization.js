"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputSanitizer = void 0;
// utils/sanitization.ts - Input sanitization and XSS protection
class InputSanitizer {
    // Sanitize string input - removes dangerous characters and patterns
    static sanitizeString(input, maxLength = 1000) {
        if (typeof input !== 'string') {
            throw new Error('Input must be a string');
        }
        // Trim whitespace
        let sanitized = input.trim();
        // Enforce max length
        if (sanitized.length > maxLength) {
            throw new Error(`Input exceeds maximum length of ${maxLength} characters`);
        }
        // Remove null bytes and control characters (except newlines/tabs for some cases)
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        // Remove potential script injection patterns
        sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        sanitized = sanitized.replace(/javascript:/gi, '');
        sanitized = sanitized.replace(/data:(?!image\/[a-z]+;base64,)/gi, '');
        sanitized = sanitized.replace(/vbscript:/gi, '');
        sanitized = sanitized.replace(/on\w+\s*=/gi, '');
        return sanitized;
    }
    // Sanitize blockchain address
    static sanitizeAddress(address) {
        if (typeof address !== 'string') {
            throw new Error('Address must be a string');
        }
        const sanitized = address.trim();
        // Check length bounds (Ethereum: 42 chars, Solana: 32-44 chars typically)
        if (sanitized.length < 20 || sanitized.length > 100) {
            throw new Error('Address length is outside valid bounds');
        }
        // Allow only alphanumeric and valid address characters
        if (!/^[a-zA-Z0-9]+$/.test(sanitized.replace(/^0x/, ''))) {
            throw new Error('Address contains invalid characters');
        }
        return sanitized;
    }
    // Sanitize chain parameter
    static sanitizeChain(chain) {
        if (typeof chain !== 'string') {
            throw new Error('Chain must be a string');
        }
        const sanitized = chain.trim().toLowerCase();
        if (sanitized !== 'bnb' && sanitized !== 'solana') {
            throw new Error('Chain must be either "bnb" or "solana"');
        }
        return sanitized;
    }
    // Sanitize IP address
    static sanitizeIP(ip) {
        if (typeof ip !== 'string') {
            return 'unknown';
        }
        const sanitized = ip.trim();
        // IPv4 pattern
        const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        // IPv6 pattern (simplified)
        const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        if (ipv4Pattern.test(sanitized) || ipv6Pattern.test(sanitized)) {
            return sanitized;
        }
        // Return sanitized version for logging
        return sanitized.replace(/[^0-9a-fA-F:.]/g, '').substring(0, 45);
    }
    // Sanitize user agent
    static sanitizeUserAgent(userAgent) {
        if (typeof userAgent !== 'string') {
            return 'unknown';
        }
        // Truncate and remove dangerous patterns
        return userAgent
            .substring(0, 500)
            .replace(/[<>'"]/g, '')
            .replace(/javascript:/gi, '')
            .replace(/data:/gi, '');
    }
    // Sanitize numeric input
    static sanitizeNumeric(input, min, max) {
        let num;
        if (typeof input === 'string') {
            // Remove non-numeric characters except decimal point and minus
            const cleaned = input.replace(/[^\d.-]/g, '');
            num = parseFloat(cleaned);
        }
        else {
            num = input;
        }
        if (isNaN(num) || !isFinite(num)) {
            throw new Error('Invalid numeric input');
        }
        if (min !== undefined && num < min) {
            throw new Error(`Number must be at least ${min}`);
        }
        if (max !== undefined && num > max) {
            throw new Error(`Number must not exceed ${max}`);
        }
        return num;
    }
    // General object sanitization
    static sanitizeObject(obj, allowedFields) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new Error('Input must be an object');
        }
        const sanitized = {};
        for (const field of allowedFields) {
            if (obj.hasOwnProperty(field) && obj[field] !== undefined && obj[field] !== null) {
                if (typeof obj[field] === 'string') {
                    sanitized[field] = this.sanitizeString(obj[field]);
                }
                else if (typeof obj[field] === 'number') {
                    sanitized[field] = this.sanitizeNumeric(obj[field]);
                }
                else {
                    // Only allow primitive types
                    if (typeof obj[field] === 'boolean') {
                        sanitized[field] = obj[field];
                    }
                }
            }
        }
        return sanitized;
    }
    // Rate limiting key sanitization
    static sanitizeRateLimitKey(key) {
        if (typeof key !== 'string') {
            return 'unknown';
        }
        return key
            .trim()
            .replace(/[^a-zA-Z0-9._:-]/g, '')
            .substring(0, 100);
    }
    // Log data sanitization
    static sanitizeLogData(data) {
        if (typeof data !== 'object' || data === null) {
            return data;
        }
        const sanitized = { ...data };
        // Remove or mask sensitive fields
        const sensitiveFields = ['privateKey', 'signature', 'seed', 'mnemonic', 'password', 'token', 'secret'];
        const addressFields = ['address', 'walletAddress', 'beneficiaryAddress', 'userAddress'];
        for (const key in sanitized) {
            if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
                sanitized[key] = '[REDACTED]';
            }
            else if (addressFields.some(field => key.toLowerCase().includes(field)) && typeof sanitized[key] === 'string') {
                const addr = sanitized[key];
                if (addr && addr.length > 10) {
                    sanitized[key] = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
                }
            }
        }
        return sanitized;
    }
}
exports.InputSanitizer = InputSanitizer;
