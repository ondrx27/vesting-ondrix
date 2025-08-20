/// <reference types="vite/client" />

import { Buffer } from 'buffer';

declare global {
  interface Window {
    Buffer: typeof Buffer;
    ethereum?: any;
    solana?: any;
  }
}

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_BACKEND_URL: string;
  readonly VITE_BNB_CONTRACT_ADDRESS: string;
  readonly VITE_BNB_TOKEN_ADDRESS: string;
  readonly VITE_SOLANA_PROGRAM_ID: string;
  readonly VITE_SOLANA_VESTING_PDA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}