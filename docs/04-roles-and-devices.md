# 04 — Roles, devices and the collector lease

## Two independent axes

- **Permission** lives on the user account: `admin` or `member`.
- **Role** lives on the device record: `collector` or `normal`.

One installer. One login screen. No separate build for the collecting
machine. Both facts are stored server-side on the relay, because a local flag
can be edited by anyone who owns the laptop.

## Permissions

| Capability | member | admin |
|---|---|---|
| View everything | yes | yes |
| Add clients, edit drafts, write user fields | yes | yes |
| Run an on-demand single-client refresh | yes | yes |
| Export | yes | yes |
| See the device roster | yes, read only | yes |
| Nominate the collector | no | yes |
| Remove a device (revokes access; best-effort wipe, Q16) | no | yes |
| Transfer admin | no | yes |

Keep this list short. In a CA firm the admin is a partner, and a partner must
not be the only person who can do daily work.

## Admin bootstrap and recovery

1. The first user to activate the firm licence becomes admin, recorded on the
   relay.
2. The relay refuses a second admin. Exactly one, always.
3. A recovery code is generated at setup and shown **once**, with a
   confirm-you-have-saved-it step.
4. Admin can transfer the role to another user. The old admin becomes a
   member in the same transaction.

The recovery code is not optional. One admin with no way back means a stolen
laptop locks a firm out of its own tool permanently.

## The collector lease

A local "I am the collector" checkbox permits split-brain: two machines both
sweeping, both writing, neither authoritative. The lease prevents it.

- The relay issues exactly one lease per firm.
- The lease is signed, carries `device_id` and an expiry (Q06: 24 hours).
- The holder renews every 60 minutes while alive.
- **Only the lease holder may publish sweep changesets.** The relay rejects a
  sweep publish from any other device.
- An unrenewed lease lapses. A dead machine releases the role by itself.

### Handoff sequence

1. Admin nominates a different device.
2. The current holder finishes the client in progress, then stops. It does not
   abandon a half-swept client.
3. The relay revokes and reissues.
4. The new holder syncs to current **before** its first sweep.

### Scope of the lease

The lease governs the **whole-book sweep only**. It does not govern:

- on-demand single-client refresh from any device,
- user-generated writes (drafts, notes, manual due dates, client codes).

Those flow through each device's own ledger stream.

## Per-client lock

Because the portal allows one live session per taxpayer, a refresh on a laptop
would silently evict the collector's session mid-run.

- Before opening a session for client X, acquire a lock on X from the relay.
- Lock length five minutes, renewable while the session is live.
- If the lock is held, the requesting device queues or reports "in use", and
  never proceeds anyway.
- Offline devices cannot acquire a lock and therefore cannot refresh.

This lock is load-bearing, not a nicety.
