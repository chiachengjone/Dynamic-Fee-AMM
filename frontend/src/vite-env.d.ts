/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_FACTORY_ADDRESS?: string;
  readonly VITE_POLL_INTERVAL_MS?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_PIPELINE_URL?: string;
  readonly VITE_PIPELINE_POLL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
