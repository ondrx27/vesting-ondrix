// middleware/security.ts - Security middleware for input sanitization and XSS protection
import { Request, Response, NextFunction } from 'express';
import { InputSanitizer } from '../utils/sanitization';
import { logger } from '../utils/logger';

// Request body sanitization middleware
export const sanitizeRequestBody = (req: Request, res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    try {
      // Sanitize common fields in request body
      if (req.body.beneficiaryAddress && typeof req.body.beneficiaryAddress === 'string') {
        req.body.beneficiaryAddress = InputSanitizer.sanitizeAddress(req.body.beneficiaryAddress);
      }
      
      if (req.body.userAddress && typeof req.body.userAddress === 'string') {
        req.body.userAddress = InputSanitizer.sanitizeAddress(req.body.userAddress);
      }
      
      if (req.body.chain && typeof req.body.chain === 'string') {
        req.body.chain = InputSanitizer.sanitizeChain(req.body.chain);
      }
      
      // Sanitize any string fields to prevent XSS
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string' && key !== 'beneficiaryAddress' && key !== 'userAddress' && key !== 'chain') {
          req.body[key] = InputSanitizer.sanitizeString(value as string, 500);
        }
      }
      
    } catch (error: any) {
      logger.warn('Request body sanitization failed', {
        error: error.message,
        ip: InputSanitizer.sanitizeIP(req.ip || 'unknown'),
        userAgent: InputSanitizer.sanitizeUserAgent(req.get('User-Agent') || 'unknown')
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

// Request header sanitization middleware
export const sanitizeHeaders = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Sanitize User-Agent
    const userAgent = req.get('User-Agent');
    if (userAgent) {
      req.headers['user-agent'] = InputSanitizer.sanitizeUserAgent(userAgent);
    }
    
    // Sanitize Referer
    const referer = req.get('Referer');
    if (referer) {
      req.headers['referer'] = InputSanitizer.sanitizeString(referer, 200);
    }
    
    // Remove potentially dangerous headers
    delete req.headers['x-forwarded-host'];
    delete req.headers['x-host'];
    
  } catch (error: any) {
    logger.warn('Header sanitization failed', {
      error: error.message,
      ip: InputSanitizer.sanitizeIP(req.ip || 'unknown')
    });
  }
  
  next();
};

// Query parameter sanitization middleware
export const sanitizeQueryParams = (req: Request, res: Response, next: NextFunction) => {
  try {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        if (key === 'user' || key.includes('address')) {
          // Handle address-like parameters
          req.query[key] = InputSanitizer.sanitizeAddress(value);
        } else if (key === 'chain') {
          // Handle chain parameter
          req.query[key] = InputSanitizer.sanitizeChain(value);
        } else {
          // General string sanitization
          req.query[key] = InputSanitizer.sanitizeString(value, 200);
        }
      }
    }
  } catch (error: any) {
    logger.warn('Query parameter sanitization failed', {
      error: error.message,
      ip: InputSanitizer.sanitizeIP(req.ip || 'unknown')
    });
    
    return res.status(400).json({
      success: false,
      error: 'Invalid query parameters',
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

// Rate limit key sanitization
export const sanitizeRateLimitKey = (req: Request) => {
  const ip = InputSanitizer.sanitizeIP(req.ip || 'unknown');
  const userAgent = InputSanitizer.sanitizeUserAgent(req.get('User-Agent') || 'unknown');
  
  // Create a sanitized key for rate limiting
  return InputSanitizer.sanitizeRateLimitKey(`${ip}-${userAgent.substring(0, 50)}`);
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
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

// Request size limit middleware
export const requestSizeLimit = (maxSize: number = 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');
    
    if (contentLength > maxSize) {
      logger.warn('Request size limit exceeded', {
        contentLength,
        maxSize,
        ip: InputSanitizer.sanitizeIP(req.ip || 'unknown')
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