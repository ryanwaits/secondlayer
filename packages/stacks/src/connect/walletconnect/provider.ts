/** WalletProvider adapter for WalletConnect v2 */

import type { WalletProvider } from "../types.ts";
import type { WcProviderConfig, WcPairResult, WcSessionData } from "./types.ts";
import { WcSession } from "./session.ts";

export class WalletConnectProvider implements WalletProvider {
  private session: WcSession;

  constructor(config: WcProviderConfig) {
    this.session = new WcSession(config);
  }

  /** Try restoring a persisted session. Returns true if valid. */
  restore(): boolean {
    return this.session.restore();
  }

  /** Initiate pairing. Returns URI for QR + approval promise. */
  async pair(): Promise<WcPairResult> {
    return this.session.pair();
  }

  async request(method: string, params?: any): Promise<any> {
    return this.session.request(method, params);
  }

  disconnect(): void {
    this.session.disconnect();
  }

  get sessionData(): WcSessionData | null {
    return this.session.session;
  }
}
