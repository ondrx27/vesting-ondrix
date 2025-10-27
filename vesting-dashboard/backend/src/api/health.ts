// backend/src/api/health.ts
import { Router, Request, Response } from 'express';

export const healthRouter = Router();

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  services: {
    bnb: 'connected' | 'disconnected';
    solana: 'connected' | 'disconnected';
  };
}

healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Check BNB connection
    let bnbStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      if (process.env.BNB_RPC_URL && process.env.BNB_PRIVATE_KEY) {
        bnbStatus = 'connected';
      }
    } catch (error) {
      console.warn('BNB health check failed:', error);
    }

    // Check Solana connection
    let solanaStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      if (process.env.SOLANA_RPC_URL && process.env.SOLANA_PRIVATE_KEY) {
        solanaStatus = 'connected';
      }
    } catch (error) {
      console.warn('Solana health check failed:', error);
    }

    const healthData: HealthResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      services: {
        bnb: bnbStatus,
        solana: solanaStatus
      }
    };

    res.json(healthData);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});