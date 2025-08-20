import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ClaimRequest, ClaimResponse } from '../types';
import { validateClaimRequest } from '../utils/validation';
import { logger } from '../utils/logger';
import { BNBService } from '../services/bnb';
import { SolanaService } from '../services/solana';

export const claimRouter = Router();

const claimLimiter = rateLimit({
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
    const body = req.body as ClaimRequest;
    return `${req.ip}-${body.beneficiaryAddress || 'unknown'}`;
  }
});

claimRouter.use(claimLimiter);

let bnbService: BNBService | null = null;
let solanaService: SolanaService | null = null;

try {
  bnbService = new BNBService();
  solanaService = new SolanaService();
  logger.info('Blockchain services initialized successfully');
} catch (error) {
  logger.error('Failed to initialize blockchain services', error);
}

function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0];
  }
  if (typeof realIp === 'string') {
    return realIp;
  }
  
  return req.connection.remoteAddress || 
         req.socket.remoteAddress || 
         'unknown';
}

claimRouter.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const clientIP = getClientIP(req);
  
  try {
    const claimRequest: ClaimRequest = req.body;
    
    logger.info('Claim request received', {
      beneficiaryAddress: claimRequest.beneficiaryAddress,
      chain: claimRequest.chain,
      userAddress: claimRequest.userAddress,
      clientIP
    });

    const validationErrors = validateClaimRequest(claimRequest);
    if (validationErrors.length > 0) {
      logger.warn('Claim request validation failed', {
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
    let claimResult: ClaimResponse;

    if (claimRequest.chain === 'bnb') {
      if (!bnbService) {
        return res.status(503).json({
          success: false,
          error: 'BNB service not available',
          timestamp: new Date().toISOString()
        });
      }

      permission = await bnbService.verifyUserPermission(
        userAddress,
        claimRequest.beneficiaryAddress
      );

      if (!permission.allowed) {
        logger.warn('Unauthorized claim attempt', {
          userAddress,
          beneficiaryAddress: claimRequest.beneficiaryAddress,
          role: permission.role,
          clientIP
        });

        return res.status(403).json({
          success: false,
          error: 'You are not authorized to claim for this beneficiary',
          timestamp: new Date().toISOString()
        });
      }

      claimResult = await bnbService.executeClaim(
        claimRequest.beneficiaryAddress,
        userAddress
      );

    } else if (claimRequest.chain === 'solana') {
      if (!solanaService) {
        return res.status(503).json({
          success: false,
          error: 'Solana service not available',
          timestamp: new Date().toISOString()
        });
      }

      const vestingPDA = process.env.SOLANA_VESTING_PDA || claimRequest.beneficiaryAddress;

      permission = await solanaService.verifyUserPermission(
        userAddress,
        vestingPDA
      );

      if (!permission.allowed) {
        logger.warn('Unauthorized Solana claim attempt', {
          userAddress,
          vestingPDA,
          role: permission.role,
          clientIP
        });

        return res.status(403).json({
          success: false,
          error: 'You are not authorized to claim for this vesting account',
          timestamp: new Date().toISOString()
        });
      }

      claimResult = await solanaService.executeClaim(vestingPDA, userAddress);

    } else {
      return res.status(400).json({
        success: false,
        error: 'Unsupported chain',
        timestamp: new Date().toISOString()
      });
    }

    logger.logClaimAttempt({
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
      logger.info('Claim completed successfully', {
        chain: claimRequest.chain,
        userAddress,
        beneficiaryAddress: claimRequest.beneficiaryAddress,
        transactionHash: claimResult.transactionHash,
        distributedAmount: claimResult.distributedAmount,
        executionTime: `${executionTime}ms`,
        clientIP
      });
    } else {
      logger.warn('Claim failed', {
        chain: claimRequest.chain,
        userAddress,
        beneficiaryAddress: claimRequest.beneficiaryAddress,
        error: claimResult.error,
        executionTime: `${executionTime}ms`,
        clientIP
      });
    }

    res.json(claimResult);

  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    logger.error('Claim endpoint error', {
      error: error.message,
      stack: error.stack,
      executionTime: `${executionTime}ms`,
      clientIP,
      body: req.body
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error during claim processing',
      timestamp: new Date().toISOString()
    });
  }
});

claimRouter.get('/status/:chain/:beneficiary', async (req: Request, res: Response) => {
  try {
    const { chain, beneficiary } = req.params;
    const userAddress = req.query.user as string;

    if (!chain || !beneficiary) {
      return res.status(400).json({
        success: false,
        error: 'Chain and beneficiary parameters are required'
      });
    }

    if (!['bnb', 'solana'].includes(chain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid chain parameter'
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
        const vestingInfo = await bnbService.getVestingInfo(beneficiary);
        claimableAmount = vestingInfo.claimableAmount.toString();
        canClaim = vestingInfo.claimableAmount > 0n;
      }
    } else if (chain === 'solana' && solanaService) {
      const vestingPDA = process.env.SOLANA_VESTING_PDA || beneficiary;
      permission = await solanaService.verifyUserPermission(userAddress, vestingPDA);
      canClaim = permission.allowed;
    } else {
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

  } catch (error: any) {
    logger.error('Status check error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check claim status'
    });
  }
});

claimRouter.get('/health', async (_req: Request, res: Response) => {
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

  } catch (error: any) {
    logger.error('Claim health check error', error);
    res.status(503).json({
      healthy: false,
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});