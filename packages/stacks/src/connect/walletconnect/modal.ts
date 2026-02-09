/** Minimal wallet picker modal (injected wallets + WC QR) */

import { qrSvg } from "./qr.ts";
import { isWalletInstalled } from "../provider.ts";

declare const document: any;

const MODAL_ID = "sl-wc-modal";

const STYLES = `
  #${MODAL_ID} { position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5) }
  #${MODAL_ID} .sl-wc-box { background:#fff;border-radius:16px;padding:24px;max-width:360px;width:90%;text-align:center;font-family:system-ui,sans-serif }
  #${MODAL_ID} .sl-wc-title { margin:0 0 16px;font-size:18px;font-weight:600;color:#1a1a1a }
  #${MODAL_ID} .sl-wc-btn { display:block;width:100%;padding:12px;margin:8px 0;border:1px solid #e5e5e5;border-radius:12px;background:#fff;cursor:pointer;font-size:15px;font-weight:500;color:#1a1a1a;transition:background .15s }
  #${MODAL_ID} .sl-wc-btn:hover { background:#f5f5f5 }
  #${MODAL_ID} .sl-wc-divider { margin:16px 0;color:#999;font-size:13px }
  #${MODAL_ID} .sl-wc-qr { margin:16px auto 0 }
  #${MODAL_ID} .sl-wc-close { position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#999 }
`;

export interface ModalOptions {
  wcUri?: string;
  onSelectInjected?: () => void;
  onClose?: () => void;
}

export function showModal(opts: ModalOptions): () => void {
  if (typeof document === "undefined") return () => {};

  // Remove existing
  document.getElementById(MODAL_ID)?.remove();

  const overlay = document.createElement("div");
  overlay.id = MODAL_ID;

  const style = document.createElement("style");
  style.textContent = STYLES;
  overlay.appendChild(style);

  const box = document.createElement("div");
  box.className = "sl-wc-box";
  box.style.position = "relative";

  // Close button
  const close = document.createElement("button");
  close.className = "sl-wc-close";
  close.textContent = "\u00d7";
  close.onclick = dismiss;
  box.appendChild(close);

  // Title
  const title = document.createElement("h2");
  title.className = "sl-wc-title";
  title.textContent = "Connect Wallet";
  box.appendChild(title);

  // Injected wallet button
  if (isWalletInstalled()) {
    const btn = document.createElement("button");
    btn.className = "sl-wc-btn";
    btn.textContent = "Browser Wallet";
    btn.onclick = () => {
      dismiss();
      opts.onSelectInjected?.();
    };
    box.appendChild(btn);
  }

  // QR code
  if (opts.wcUri) {
    if (isWalletInstalled()) {
      const divider = document.createElement("div");
      divider.className = "sl-wc-divider";
      divider.textContent = "or scan with mobile wallet";
      box.appendChild(divider);
    }

    const qr = document.createElement("div");
    qr.className = "sl-wc-qr";
    qr.innerHTML = qrSvg(opts.wcUri, { size: 240 });
    box.appendChild(qr);
  }

  overlay.appendChild(box);
  overlay.onclick = (e: any) => {
    if (e.target === overlay) dismiss();
  };

  document.body.appendChild(overlay);

  function dismiss() {
    overlay.remove();
    opts.onClose?.();
  }

  return dismiss;
}

export function hideModal() {
  if (typeof document === "undefined") return;
  document.getElementById(MODAL_ID)?.remove();
}
