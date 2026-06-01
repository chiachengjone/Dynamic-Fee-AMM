import type { Eip1193Provider } from "ethers";

// MetaMask (and other EIP-1193 wallets) inject this into the page.
declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      isMetaMask?: boolean;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export {};
