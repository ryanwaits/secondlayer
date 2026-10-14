/** The twin's `mint`, verbatim from evm/src/Twin.sol. */
export const TWIN_MINT = String.raw`function mint(uint256 lockNonce, address to, uint256 amount) external {
    // !callout[/minter/] Phase 0: a 2-of-2 Safe
    if (msg.sender != minter) revert NotMinter();
    // !callout[/minted\[lockNonce\]/] One mint per Stacks lock
    if (minted[lockNonce]) revert AlreadyMinted(lockNonce);
    if (amount == 0) revert ZeroAmount();
    minted[lockNonce] = true;
    _mint(to, amount);
    // !callout[/Minted/] Public, and names its lock
    emit Minted(lockNonce, to, amount);
}`;

/** How the relayer reads locks, from relayer/src/sources.ts. */
export const RELAYER_READ = String.raw`const client = createStreamsClient({
  baseUrl: config.apiUrl,
  apiKey: config.apiKey,
});
await client.events.consume({
  types: ["print"],
  // !callout[/locker/] Only the locker's prints
  contractId: locker,
  // !callout[/true/] Counts a lock once Bitcoin finalizes it
  finalizedOnly: true,
  // !callout[/config\.fromCursor/] Every start rescans from deploy
  fromCursor: config.fromCursor,
  mode: once ? "bounded" : "tail",
  signal,
  onBatch: (events) => onLocks(events.flatMap(decodeLock)),
});`;
