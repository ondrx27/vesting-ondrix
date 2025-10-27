"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestSizeLimit = exports.securityHeaders = exports.sanitizeRateLimitKey = exports.sanitizeQueryParams = exports.sanitizeHeaders = exports.sanitizeRequestBody = void 0;
const sanitization_1 = require("../utils/sanitization");
const logger_1 = require("../utils/logger");
// Request body sanitization middleware
const sanitizeRequestBody = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        try {
            // Sanitize common fields in request body
            if (req.body.beneficiaryAddress && typeof req.body.beneficiaryAddress === 'string') {
                req.body.beneficiaryAddress = sanitization_1.InputSanitizer.sanitizeAddress(req.body.beneficiaryAddress);
            }
            if (req.body.userAddress && typeof req.body.userAddress === 'string') {
                req.body.userAddress = sanitization_1.InputSanitizer.sanitizeAddress(req.body.userAddress);
            }
            if (req.body.chain && typeof req.body.chain === 'string') {
                req.body.chain = sanitization_1.InputSanitizer.sanitizeChain(req.body.chain);
            }
            // Sanitize any string fields to prevent XSS
            for (const [key, value] of Object.entries(req.body)) {
                if (typeof value === 'string' && key !== 'beneficiaryAddress' && key !== 'userAddress' && key !== 'chain') {
                    req.body[key] = sanitization_1.InputSanitizer.sanitizeString(value, 500);
                }
            }
        }
        catch (error) {
            logger_1.logger.warn('Request body sanitization failed', {
                error: error.message,
                ip: sanitization_1.InputSanitizer.sanitizeIP(req.ip || 'unknown'),
                userAgent: sanitization_1.InputSanitizer.sanitizeUserAgent(req.get('User-Agent') || 'unknown')
            });
            return res.status(400).json({
                success: false,
                error: 'Invalid request data',
                timestamp: new Date().toISOString()
            });
        }
    }
    next();
};
exports.sanitizeRequestBody = sanitizeRequestBody;
// Request header sanitization middleware
const sanitizeHeaders = (req, res, next) => {
    try {
        // Sanitize User-Agent
        const userAgent = req.get('User-Agent');
        if (userAgent) {
            req.headers['user-agent'] = sanitization_1.InputSanitizer.sanitizeUserAgent(userAgent);
        }
        // Sanitize Referer
        const referer = req.get('Referer');
        if (referer) {
            req.headers['referer'] = sanitization_1.InputSanitizer.sanitizeString(referer, 200);
        }
        // Remove potentially dangerous headers
        delete req.headers['x-forwarded-host'];
        delete req.headers['x-host'];
    }
    catch (error) {
        logger_1.logger.warn('Header sanitization failed', {
            error: error.message,
            ip: sanitization_1.InputSanitizer.sanitizeIP(req.ip || 'unknown')
        });
    }
    next();
};
exports.sanitizeHeaders = sanitizeHeaders;
// Query parameter sanitization middleware
const sanitizeQueryParams = (req, res, next) => {
    try {
        for (const [key, value] of Object.entries(req.query)) {
            if (typeof value === 'string') {
                if (key === 'user' || key.includes('address')) {
                    // Handle address-like parameters
                    req.query[key] = sanitization_1.InputSanitizer.sanitizeAddress(value);
                }
                else if (key === 'chain') {
                    // Handle chain parameter
                    req.query[key] = sanitization_1.InputSanitizer.sanitizeChain(value);
                }
                else {
                    // General string sanitization
                    req.query[key] = sanitization_1.InputSanitizer.sanitizeString(value, 200);
                }
            }
        }
    }
    catch (error) {
        logger_1.logger.warn('Query parameter sanitization failed', {
            error: error.message,
            ip: sanitization_1.InputSanitizer.sanitizeIP(req.ip || 'unknown')
        });
        return res.status(400).json({
            success: false,
            error: 'Invalid query parameters',
            timestamp: new Date().toISOString()
        });
    }
    next();
};
exports.sanitizeQueryParams = sanitizeQueryParams;
// Rate limit key sanitization
const sanitizeRateLimitKey = (req) => {
    const ip = sanitization_1.InputSanitizer.sanitizeIP(req.ip || 'unknown');
    const userAgent = sanitization_1.InputSanitizer.sanitizeUserAgent(req.get('User-Agent') || 'unknown');
    // Create a sanitized key for rate limiting
    return sanitization_1.InputSanitizer.sanitizeRateLimitKey(`${ip}-${userAgent.substring(0, 50)}`);
};
exports.sanitizeRateLimitKey = sanitizeRateLimitKey;
// Security headers middleware
const securityHeaders = (req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    // Remove server information
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'VestingAPI');
    next();
};
exports.securityHeaders = securityHeaders;
// Request size limit middleware
const requestSizeLimit = (maxSize = 1024 * 1024) => {
    return (req, res, next) => {
        const contentLength = parseInt(req.get('Content-Length') || '0');
        if (contentLength > maxSize) {
            logger_1.logger.warn('Request size limit exceeded', {
                contentLength,
                maxSize,
                ip: sanitization_1.InputSanitizer.sanitizeIP(req.ip || 'unknown')
            });
            return res.status(413).json({
                success: false,
                error: 'Request entity too large',
                timestamp: new Date().toISOString()
            });
        }
        next();
    };
};
exports.requestSizeLimit = requestSizeLimit;
