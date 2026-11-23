;; spv-adapter -- a thin, read-only reference wrapper over the SIP-044 (Clarity 6)
;; Bitcoin SPV built-ins. The built-ins are callable only from within a Clarity
;; contract, not over RPC; this contract exposes them as read-only functions so
;; the @secondlayer/stacks `bitcoinVerifier` (and any integrator) can reach them.

(define-constant ERR_BAD_HEADER (err u1))
(define-constant ERR_BAD_SLICE (err u2))

(define-private (prepend-byte (b (buff 1)) (acc (buff 32)))
  (default-to acc (as-max-len? (concat b acc) u32))
)

(define-read-only (reverse-buff32 (input (buff 32)))
  (fold prepend-byte input 0x)
)

(define-read-only (header-merkle-root (header (buff 80)))
  (match (slice? header u36 u68)
    sliced (as-max-len? sliced u32)
    none)
)

(define-read-only (get-tx-output (tx (buff 4096)) (vout uint))
  (get-bitcoin-tx-output? tx vout)
)

(define-read-only (verify-merkle
    (leaf (buff 32))
    (root (buff 32))
    (tx-index uint)
    (tx-count uint)
    (siblings (list 24 (buff 32))))
  (verify-merkle-proof leaf root tx-index tx-count siblings)
)

(define-read-only (was-tx-mined
    (header (buff 80))
    (height uint)
    (leaf (buff 32))
    (tx-index uint)
    (tx-count uint)
    (siblings (list 24 (buff 32))))
  (let (
        (root (unwrap! (header-merkle-root header) ERR_BAD_SLICE))
       )
    (if (is-eq (get-burn-block-info? header-hash height)
               (some (reverse-buff32 (sha256 (sha256 header)))))
        (ok (verify-merkle-proof leaf root tx-index tx-count siblings))
        ERR_BAD_HEADER)
  )
)
