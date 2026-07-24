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
[Solana Explorer](https://explorer.solana.com/tx/2PaJbnBowm4rbqMshwAygkLivwZ5yGc3uo1hELdTPaML8gfz1U49NWnnHu8mt3eLVxcN7euJviiXyAATxGCK1Fu?cluster=devnet).
Offline verification checks artifact integrity and internal consistency; it
does not authenticate the evidence producer. Online verification additionally
rechecks the recorded payment against Solana and retains the same producer
authentication limitation.
