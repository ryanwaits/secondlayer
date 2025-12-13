;; Simple Token Contract

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (ok true)
)

(define-read-only (get-balance (account principal))
  (ok u0)
)

(define-read-only (get-name)
  (ok "Simple Token")
)
