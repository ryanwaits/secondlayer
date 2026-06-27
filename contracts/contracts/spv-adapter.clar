;; spv-adapter -- a thin, read-only reference wrapper over the SIP-044 (Clarity 6)
;; Bitcoin SPV built-ins. The built-ins are callable only from within a Clarity
;; contract, not over RPC; this contract exposes them as read-only functions so
;; the @secondlayer/stacks `bitcoinVerifier` (and any integrator) can reach them.
;;
;; No state, no admin, no custody -- it only reads. Requires Clarity 6 / Stacks
;; Epoch 4.0 (where `get-bitcoin-tx-output?` and `verify-merkle-proof` exist).
;;
;; Byte order: 32-byte hashes (txids, merkle roots, siblings) are INTERNAL order
;; (raw double-SHA-256), matching the built-ins. The only display-order value is
;; the block hash returned by `get-burn-block-info? header-hash`, which is
;; reversed before comparison.

(define-constant ERR-BAD-HEADER (err u1)) ;; header not canonical at that height
(define-constant ERR-BAD-SLICE (err u2)) ;; header merkle-root slice failed

;; --- byte helpers -----------------------------------------------------------

(define-private (prepend-byte (b (buff 1)) (acc (buff 32)))
  (unwrap-panic (as-max-len? (concat b acc) u32))
)

;; Reverse a 32-byte buffer (internal <-> display order) by folding each byte
;; onto the front of the accumulator.
(define-read-only (reverse-buff32 (input (buff 32)))
  (fold prepend-byte input 0x)
)

;; The merkle root committed by an 80-byte block header: bytes [36, 68),
;; internal order -- ready to pass straight to `verify-merkle-proof`.
(define-read-only (header-merkle-root (header (buff 80)))
  (match (slice? header u36 u68)
    sliced (as-max-len? sliced u32)
    none)
)

;; --- built-in passthroughs --------------------------------------------------

;; (get-bitcoin-tx-output? tx vout): parse one output of a serialized BTC tx.
(define-read-only (get-tx-output (tx (buff 4096)) (vout uint))
  (get-bitcoin-tx-output? tx vout)
)

;; (verify-merkle-proof ...): prove tx inclusion under a supplied merkle root.
;; This is membership only -- the root is not authenticated against the chain
;; here. Use `was-tx-mined` for the full check.
(define-read-only (verify-merkle
    (leaf (buff 32))
    (root (buff 32))
    (tx-index uint)
    (tx-count uint)
    (siblings (list 24 (buff 32))))
  (verify-merkle-proof leaf root tx-index tx-count siblings)
)

;; --- composed SPV check -----------------------------------------------------

;; Authenticate a caller-supplied 80-byte header against the chain's record at
;; `height` (`get-burn-block-info? header-hash`), extract its merkle root, and
;; prove the leaf is committed under it -- atomically.
;;   (ok true)  -- header is canonical AND the tx is included (mined)
;;   (ok false) -- header is canonical but the tx is not included
;;   (err u1)   -- header is not the canonical block at `height`
;;   (err u2)   -- header merkle-root slice failed (malformed header length)
;; Note: `height` is the Bitcoin/burn block height. A "flash block" (two BTC
;; blocks in one Stacks tenure) has no recorded header-hash for the skipped
;; block, so a tx mined there returns (err u1) -- the known SPV edge case.
(define-read-only (was-tx-mined
    (header (buff 80))
    (height uint)
    (leaf (buff 32))
    (tx-index uint)
    (tx-count uint)
    (siblings (list 24 (buff 32))))
  (let (
        (root (unwrap! (header-merkle-root header) ERR-BAD-SLICE))
       )
    (if (is-eq (get-burn-block-info? header-hash height)
               (some (reverse-buff32 (sha256 (sha256 header)))))
        (ok (verify-merkle-proof leaf root tx-index tx-count siblings))
        ERR-BAD-HEADER)
  )
)
