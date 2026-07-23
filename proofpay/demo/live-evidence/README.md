# Committed live devnet evidence

This directory contains the public evidence JSON produced during the recorded
ZeroClaw demo. It refers only to public devnet data and the sample deliverable
already committed to this repository. It contains no private key, seed phrase,
wallet session, API credential, customer data, or deliverable contents.

Verify the evidence and deliverable from a clean checkout without a network
connection:

```sh
npm run verify:live-evidence
```

Repeat the complete payment checks against the allowlisted Solana devnet RPC:

```sh
npm run verify:live-evidence:online
```

The finalized transaction is independently visible in the
[Solana Explorer](https://explorer.solana.com/tx/5Du1jycfRHexow5gWCpFoVyKtj26N2ika6W7DzFj7PS3V3k1AsX1TFY2psJsnmCT6Aknk4T2YLkc4MJUy3qYya6R?cluster=devnet).
Offline verification checks artifact integrity and internal consistency; it
does not authenticate the evidence producer. Online verification additionally
rechecks the recorded payment against Solana and retains the same producer
authentication limitation.
