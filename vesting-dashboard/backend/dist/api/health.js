"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
// backend/src/api/health.ts
const express_1 = require("express");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get('/', async (req, res) => {
    try {
        // Check BNB connection
        let bnbStatus = 'disconnected';
        try {
            if (process.env.BNB_RPC_URL && process.env.BNB_PRIVATE_KEY) {
                bnbStatus = 'connected';
            }
        }
        catch (error) {
            console.warn('BNB health check failed:', error);
        }
        // Check Solana connection
        let solanaStatus = 'disconnected';
        try {
            if (process.env.SOLANA_RPC_URL && process.env.SOLANA_PRIVATE_KEY) {
                solanaStatus = 'connected';
            }
        }
        catch (error) {
            console.warn('Solana health check failed:', error);
        }
        const healthData = {
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
    }
    catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Health check failed'
        });
    }
});
