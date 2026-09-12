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
7. **Remote wipe is best-effort.** Removing a device revokes relay access
   at once; the device deletes its own book and keys the next time it comes
   online with the app open, after handing over pending entries (Q16). A
   disk image or a machine that never reconnects is untouched, and the
   admin's dialog says so.

## What the relay holds beyond routing (Q17)

Collector-silent alerts are emailed, so **staff email addresses live on the
relay** (`devices.email`, set at enrolment or from Devices). They are the
only personal data the relay stores in the clear; they are never inside a
sealed blob and are used for nothing but these alerts. SMTP settings are
environment variables on the relay host (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`); with none set,
alerts are logged and not sent.

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
