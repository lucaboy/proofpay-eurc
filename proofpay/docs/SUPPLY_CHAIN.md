# Submission bundle and build provenance

ProofPay's CI packages each tested commit as a deterministic source bundle.
This is separate from the payment evidence described in `EVIDENCE.md`: it
attests which repository commit produced the downloadable submission archive,
not who approved or paid an invoice.

## CI trust boundary

The workflow follows these controls:

- every third-party GitHub Action is pinned to a full commit SHA;
- checkout disables persisted Git credentials;
- jobs have explicit timeouts and deny token permissions by default;
- tests and bundle creation run without write or OIDC permissions;
- the bundle is read from committed Git blobs, never from ignored or untracked
  working-tree files;
- a separate job receives only `id-token: write`, `attestations: write`, and
  `artifact-metadata: write`; it does not check out or execute repository code;
- only a successful push to `main` receives a GitHub/Sigstore build-provenance
  attestation.

The archive normalizes file order, modes, ownership, timestamps, gzip metadata,
and the DEFLATE layout. It uses stored DEFLATE blocks so output does not depend
on a platform's compression-library version. It contains:

- all files in the source commit;
- `SOURCE_COMMIT`, containing the full source commit ID;
- an internal `SHA256SUMS`, covering every source file and `SOURCE_COMMIT`.

The uploaded Actions artifact contains
`proofpay-eurc-submission.tar.gz` and an external `SHA256SUMS` covering that
archive. The GitHub attestation uses the external checksum as its subject.

## Build locally

From the repository root:

```sh
node scripts/build-submission-bundle.mjs --source-ref HEAD --verify
```

The builder deliberately packages `HEAD`, not uncommitted working-tree
changes. `--verify` rebuilds independently in the same process and fails if the
archive bytes differ.

Verify the outer checksum on Linux:

```sh
(cd dist && sha256sum --check SHA256SUMS)
```

On macOS, use:

```sh
(cd dist && shasum -a 256 --check SHA256SUMS)
```

Then unpack and verify every bundled source file:

```sh
verify_dir="$(mktemp -d)"
tar -xzf dist/proofpay-eurc-submission.tar.gz \
  -C "${verify_dir}"
(cd "${verify_dir}/proofpay-eurc-submission" \
  && sha256sum --check SHA256SUMS)
```

On macOS, replace the final command with:

```sh
(cd "${verify_dir}/proofpay-eurc-submission" \
  && shasum -a 256 --check SHA256SUMS)
```

Use a fresh temporary directory rather than extracting over a checkout.

## Verify GitHub provenance

Download the `proofpay-eurc-submission` artifact from a successful `main`
workflow run, verify its checksum, then verify the signed provenance:

```sh
gh run download RUN_ID \
  --repo lucaboy/proofpay-eurc \
  --name proofpay-eurc-submission \
  --dir dist
(cd dist && sha256sum --check SHA256SUMS)

gh attestation verify \
  dist/proofpay-eurc-submission.tar.gz \
  --repo lucaboy/proofpay-eurc
```

On macOS, use `shasum -a 256 --check SHA256SUMS` from `dist` in place
of `sha256sum`.

The verification proves that GitHub Actions in this repository attested the
archive digest. It does not prove the semantic correctness of the application,
the safety of the runner image, or any invoice/payment claim. Review the pinned
workflow, run the offline tests, compare `SOURCE_COMMIT`, and validate the
internal checksums as independent controls. GitHub documents the signature and
verification model in
[Using artifact attestations to establish provenance for
builds](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds).
