# 07 — Security

The firm holds two hundred clients' tax affairs in one place. Treat this as a
first-order concern, not a finishing pass.

## What we hold

| Asset | Sensitivity | Where it lives |
|---|---|---|
| Portal passwords | high | OS keychain only, never the database |
| ERI signing key | very high | collector device only, never synced |
| Firm sync key | high | every firm device, never the relay |
| Client PII (PAN, phone, name) | high | encrypted database |
| Notice PDFs | high | encrypted document store |
| Recovery code | high | shown once, user's responsibility |

## Rules

1. **No credential in any file.** Not source, config, fixtures, tests, logs,
   error messages, or commit history. Not even a realistic-looking placeholder.
2. **Keychain for passwords.** Windows Credential Manager, macOS Keychain,
   libsecret on Linux, via the Tauri keychain plugin. The database stores a
   reference, never the secret.
3. **Database at rest** is SQLCipher-encrypted; the key is held in the
   keychain and never written to disk in plaintext.
4. **Relay is zero-knowledge.** Changesets are sealed with the firm key before
   they leave a device. The relay stores ciphertext and routing metadata. It
   must be impossible for an operator of the relay to read client data.
5. **Logs are masked.** PAN renders as `AABCV••••K`. Phone numbers are
   truncated. Client names are replaced by client id in any log line.
6. **On-demand credential fetch.** When a laptop refreshes one client, it
   requests only that client's sealed credential, uses it, and drops it. The
   request is recorded in the audit log. A stolen laptop must not be two
   hundred logins.
7. **No remote wipe promised.** Removing a device revokes relay access only
   (Q16). Do not imply more in the UI than the code actually does.

## Crypto choices

| Purpose | Algorithm |
|---|---|
| Changeset and bundle encryption | AES-256-GCM |
| Passphrase to key | Argon2id |
| Device identity | Ed25519 keypair, generated on device |
| Bundle integrity | Ed25519 detached signature over the manifest |
| Document identity | SHA-256 |

Do not invent protocols. Use vetted library primitives with standard modes.

## Threat model — what we defend against

- Relay operator or relay breach reading client data → defeated by
  zero-knowledge sealing.
- Lost or stolen laptop → database encrypted at rest; credentials in keychain;
  admin revokes the device from the roster.
- A malicious insider at the firm → audit log of runs, credential fetches and
  role changes. Not prevented, but attributable.
- Accidental leak through logs, exports or crash reports → masking rules above.

## What we do not defend against

Be honest in the UI about these.

- A compromised collector machine. It holds the firm key by necessity.
- A user who exports a bundle with credentials and mishandles the file.
- Anything on the portal side.

## Pre-commit checks

Add a hook that rejects a commit containing anything matching the shapes of a
PAN, an Indian mobile number, a private key header, or a high-entropy string
assigned to a variable named like a secret. False positives are acceptable;
a committed password is not.

If you discover a secret already in the repository history, record it in
`NOTES.md` under `ROTATE IMMEDIATELY` **by description only**, never by value.
