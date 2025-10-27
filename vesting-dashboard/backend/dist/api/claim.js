"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimRouter = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const sanitization_1 = require("../utils/sanitization");
const errorHandler_1 = require("../utils/errorHandler");
const bnb_1 = require("../services/bnb");
const solana_1 = require("../services/solana");
exports.claimRouter = (0, express_1.Router)();
const claimLimiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5'),
    message: {
        success: false,
        error: 'Too many claim attempts from this IP, please try again later.',
        timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const body = req.body;
        return `${req.ip}-${body.beneficiaryAddress || 'unknown'}`;
    }
});
exports.claimRouter.use(claimLimiter);
let bnbService = null;
let solanaService = null;
try {
    bnbService = new bnb_1.BNBService();
    solanaService = new solana_1.SolanaService();
    logger_1.logger.info('Blockchain services initialized successfully');
}
catch (error) {
    logger_1.logger.error('Failed to initialize blockchain services', error);
}
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    let rawIP = 'unknown';
    if (typeof forwarded === 'string') {
        rawIP = forwarded.split(',')[0];
    }
    else if (typeof realIp === 'string') {
        rawIP = realIp;
    }
    else {
        rawIP = req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            'unknown';
    }
    return sanitization_1.InputSanitizer.sanitizeIP(rawIP);
}
exports.claimRouter.post('/', async (req, res) => {
    const startTime = Date.now();
    const clientIP = getClientIP(req);
    try {
        const claimRequest = req.body;
        logger_1.logger.info('Claim request received', sanitization_1.InputSanitizer.sanitizeLogData({
            beneficiaryAddress: claimRequest.beneficiaryAddress,
            chain: claimRequest.chain,
            userAddress: claimRequest.userAddress,
            clientIP
        }));
        const validationErrors = (0, validation_1.validateClaimRequest)(claimRequest);
        if (validationErrors.length > 0) {
            logger_1.logger.warn('Claim request validation failed', {
                errors: validationErrors,
                clientIP
            });
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validationErrors,
                timestamp: new Date().toISOString()
            });
        }
        const userAddress = claimRequest.userAddress || claimRequest.beneficiaryAddress;
        let permission;
        let claimResult;
        if (claimRequest.chain === 'bnb') {
            if (!bnbService) {
                return res.status(503).json({
                    success: false,
                    error: 'BNB service not available',
                    timestamp: new Date().toISOString()
                });
            }
            permission = await bnbService.verifyUserPermission(userAddress, claimRequest.beneficiaryAddress);
            if (!permission.allowed) {
                logger_1.logger.warn('Unauthorized claim attempt', sanitization_1.InputSanitizer.sanitizeLogData({
                    userAddress,
                    beneficiaryAddress: claimRequest.beneficiaryAddress,
                    role: permission.role,
                    clientIP
                }));
                return res.status(403).json({
                    success: false,
                    error: 'You are not authorized to claim for this beneficiary',
                    timestamp: new Date().toISOString()
                });
            }
            claimResult = await bnbService.executeClaim(claimRequest.beneficiaryAddress, userAddress);
        }
        else if (claimRequest.chain === 'solana') {
            if (!solanaService) {
                return res.status(503).json({
                    success: false,
                    error: 'Solana service not available',
                    timestamp: new Date().toISOString()
                });
            }
            const vestingPDA = process.env.SOLANA_VESTING_PDA || claimRequest.beneficiaryAddress;
            permission = await solanaService.verifyUserPermission(userAddress, vestingPDA);
            if (!permission.allowed) {
                logger_1.logger.warn('Unauthorized Solana claim attempt', sanitization_1.InputSanitizer.sanitizeLogData({
                    userAddress,
                    vestingPDA,
                    role: permission.role,
                    clientIP
                }));
                return res.status(403).json({
                    success: false,
                    error: 'You are not authorized to claim for this vesting account',
                    timestamp: new Date().toISOString()
                });
            }
            claimResult = await solanaService.executeClaim(vestingPDA, userAddress);
        }
        else {
            return res.status(400).json({
                success: false,
                error: 'Unsupported chain',
                timestamp: new Date().toISOString()
            });
        }
        logger_1.logger.logClaimAttempt({
            userAddress,
            beneficiaryAddress: claimRequest.beneficiaryAddress,
            chain: claimRequest.chain,
            success: claimResult.success,
            role: permission.role,
            error: claimResult.error,
            transactionHash: claimResult.transactionHash,
            distributedAmount: claimResult.distributedAmount,
            ipAddress: clientIP
        });
        const executionTime = Date.now() - startTime;
        if (claimResult.success) {
            logger_1.logger.info('Claim completed successfully', sanitization_1.InputSanitizer.sanitizeLogData({
                chain: claimRequest.chain,
                userAddress,
                beneficiaryAddress: claimRequest.beneficiaryAddress,
                transactionHash: claimResult.transactionHash,
                distributedAmount: claimResult.distributedAmount,
                executionTime: `${executionTime}ms`,
                clientIP
            }));
        }
        else {
            logger_1.logger.warn('Claim failed', sanitization_1.InputSanitizer.sanitizeLogData({
                chain: claimRequest.chain,
                userAddress,
                beneficiaryAddress: claimRequest.beneficiaryAddress,
                error: claimResult.error,
                executionTime: `${executionTime}ms`,
                clientIP
            }));
        }
        res.json(claimResult);
    }
    catch (error) {
        const executionTime = Date.now() - startTime;
        const safeError = errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'Claim endpoint', {
            executionTime: `${executionTime}ms`,
            clientIP,
            body: req.body
        }, 'Internal server error during claim processing');
        res.status(safeError.statusCode || 500).json({
            success: false,
            error: safeError.message,
            timestamp: safeError.timestamp
        });
    }
});
exports.claimRouter.get('/status/:chain/:beneficiary', async (req, res) => {
    try {
        let { chain, beneficiary } = req.params;
        let userAddress = req.query.user;
        // Sanitize route parameters
        if (!chain || !beneficiary) {
            return res.status(400).json({
                success: false,
                error: 'Chain and beneficiary parameters are required'
            });
        }
        try {
            chain = sanitization_1.InputSanitizer.sanitizeChain(chain);
            beneficiary = sanitization_1.InputSanitizer.sanitizeAddress(beneficiary);
            if (userAddress) {
                userAddress = sanitization_1.InputSanitizer.sanitizeAddress(userAddress);
            }
        }
        catch (sanitizeError) {
            return res.status(400).json({
                success: false,
                error: `Invalid parameter: ${sanitizeError.message}`
            });
        }
        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: 'User address required'
            });
        }
        let permission;
        let canClaim = false;
        let claimableAmount = '0';
        if (chain === 'bnb' && bnbService) {
            permission = await bnbService.verifyUserPermission(userAddress, beneficiary);
            if (permission.allowed) {
                if (permission.role === 'initializer') {
                    // For initializers, get overall claimable amount
                    const vestingInfo = await bnbService.getVestingInfo(beneficiary);
                    claimableAmount = vestingInfo.claimableAmount.toString();
                    canClaim = vestingInfo.claimableAmount > 0n;
                }
                else if (permission.role === 'recipient') {
                    // For recipients, get their individual claimable amount
                    const recipientInfo = await bnbService.getRecipientClaimInfo(beneficiary, userAddress);
                    claimableAmount = recipientInfo.claimableAmount.toString();
                    canClaim = recipientInfo.canClaim && recipientInfo.claimableAmount > 0n;
                }
            }
        }
        else if (chain === 'solana' && solanaService) {
            const vestingPDA = process.env.SOLANA_VESTING_PDA || beneficiary;
            permission = await solanaService.verifyUserPermission(userAddress, vestingPDA);
            canClaim = permission.allowed;
        }
        else {
            permission = { allowed: false, role: 'none' };
        }
        res.json({
            success: true,
            canClaim,
            claimableAmount,
            userRole: permission.role,
            authorized: permission.allowed,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        const safeError = errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'Claim status check', { chain, beneficiary, userAddress }, 'Failed to check claim status');
        res.status(safeError.statusCode || 500).json({
            success: false,
            error: safeError.message,
            timestamp: safeError.timestamp
        });
    }
});
exports.claimRouter.get('/health', async (_req, res) => {
    try {
        const healthChecks = await Promise.allSettled([
            bnbService?.healthCheck() || Promise.resolve({ healthy: false, error: 'Service not initialized' }),
            solanaService?.healthCheck() || Promise.resolve({ healthy: false, error: 'Service not initialized' })
        ]);
        const bnbHealth = healthChecks[0].status === 'fulfilled' ? healthChecks[0].value : { healthy: false, error: 'Service unavailable' };
        const solanaHealth = healthChecks[1].status === 'fulfilled' ? healthChecks[1].value : { healthy: false, error: 'Service unavailable' };
        const overallHealthy = bnbHealth?.healthy && solanaHealth?.healthy;
        res.status(overallHealthy ? 200 : 503).json({
            healthy: overallHealthy,
            services: {
                bnb: bnbHealth,
                solana: solanaHealth
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        const safeError = errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'Claim health check', {}, 'Health check failed');
        res.status(503).json({
            healthy: false,
            error: safeError.message,
            timestamp: safeError.timestamp
        });
    }
});
