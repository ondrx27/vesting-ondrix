"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateClaimRequest = validateClaimRequest;
exports.isValidAddress = isValidAddress;
exports.sanitizeAddress = sanitizeAddress;
exports.isAddressEqual = isAddressEqual;
exports.validateEnvironment = validateEnvironment;
const ethers_1 = require("ethers");
const web3_js_1 = require("@solana/web3.js");
const sanitization_1 = require("./sanitization");
function validateClaimRequest(req) {
    const errors = [];
    // Sanitize and validate beneficiaryAddress
    if (!req.beneficiaryAddress) {
        errors.push({
            field: 'beneficiaryAddress',
            message: 'Beneficiary address is required'
        });
    }
    else {
        try {
            const sanitizedAddress = sanitization_1.InputSanitizer.sanitizeAddress(req.beneficiaryAddress);
            if (!isValidAddress(sanitizedAddress, req.chain)) {
                errors.push({
                    field: 'beneficiaryAddress',
                    message: `Invalid ${req.chain} address format`
                });
            }
            else {
                // Update the request with sanitized value
                req.beneficiaryAddress = sanitizedAddress;
            }
        }
        catch (sanitizeError) {
            errors.push({
                field: 'beneficiaryAddress',
                message: `Invalid beneficiary address: ${sanitizeError.message}`
            });
        }
    }
    // Sanitize and validate chain
    if (!req.chain) {
        errors.push({
            field: 'chain',
            message: 'Chain is required'
        });
    }
    else {
        try {
            req.chain = sanitization_1.InputSanitizer.sanitizeChain(req.chain);
        }
        catch (sanitizeError) {
            errors.push({
                field: 'chain',
                message: sanitizeError.message
            });
        }
    }
    // Sanitize and validate userAddress if provided
    if (req.userAddress) {
        try {
            const sanitizedUserAddress = sanitization_1.InputSanitizer.sanitizeAddress(req.userAddress);
            if (!isValidAddress(sanitizedUserAddress, req.chain)) {
                errors.push({
                    field: 'userAddress',
                    message: `Invalid ${req.chain} user address format`
                });
            }
            else {
                req.userAddress = sanitizedUserAddress;
            }
        }
        catch (sanitizeError) {
            errors.push({
                field: 'userAddress',
                message: `Invalid user address: ${sanitizeError.message}`
            });
        }
    }
    return errors;
}
function isValidAddress(address, chain) {
    try {
        if (chain === 'bnb') {
            return ethers_1.ethers.isAddress(address);
        }
        else if (chain === 'solana') {
            new web3_js_1.PublicKey(address);
            return true;
        }
        return false;
    }
    catch (error) {
        return false;
    }
}
function sanitizeAddress(address) {
    return address.trim().toLowerCase();
}
function isAddressEqual(addr1, addr2, chain) {
    if (chain === 'bnb') {
        return addr1.toLowerCase() === addr2.toLowerCase();
    }
    else {
        return addr1 === addr2;
    }
}
function validateEnvironment() {
    const errors = [];
    const requiredVars = [
        'BNB_RPC_URL',
        'BNB_CONTRACT_ADDRESS',
        'BNB_PRIVATE_KEY',
        'SOLANA_RPC_URL',
        'SOLANA_PROGRAM_ID',
        'SOLANA_PRIVATE_KEY'
    ];
    for (const varName of requiredVars) {
        if (!process.env[varName]) {
            errors.push(`Missing environment variable: ${varName}`);
        }
    }
    if (process.env.BNB_PRIVATE_KEY) {
        try {
            new ethers_1.ethers.Wallet(process.env.BNB_PRIVATE_KEY);
        }
        catch (error) {
            errors.push('Invalid BNB_PRIVATE_KEY format');
        }
    }
    if (process.env.SOLANA_PRIVATE_KEY) {
        try {
            const keyArray = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
            if (!Array.isArray(keyArray) || keyArray.length !== 64) {
                errors.push('Invalid SOLANA_PRIVATE_KEY format - must be 64-byte array');
            }
        }
        catch (error) {
            errors.push('Invalid SOLANA_PRIVATE_KEY format - must be valid JSON array');
        }
    }
    if (process.env.BNB_CONTRACT_ADDRESS && !ethers_1.ethers.isAddress(process.env.BNB_CONTRACT_ADDRESS)) {
        errors.push('Invalid BNB_CONTRACT_ADDRESS format');
    }
    if (process.env.SOLANA_PROGRAM_ID) {
        try {
            new web3_js_1.PublicKey(process.env.SOLANA_PROGRAM_ID);
        }
        catch (error) {
            errors.push('Invalid SOLANA_PROGRAM_ID format');
        }
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
