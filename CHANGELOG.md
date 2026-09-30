# Changelog

## 0.7.0

Paired with the keelgrc-v1 change that moves `POST /api/v1/people` from "any role except
auditor" to owner or admin (D824). The role check is on the Keel side, so it applies to
every version of this server as soon as that change deploys.

Also paired with the keelgrc-v1 change that makes webhook signing real (D827a):
`POST /api/v1/hooks` generates a signing secret, stores it, and returns it once in the 201
body. Deliveries to that subscription then carry `x-keel-signature`.

The same keelgrc-v1 change settles the signature format before anything consumes it
(D829a): the header value is `v1=<hex>`, deliveries carry `x-keel-event-id` and
`x-keel-subscription-id`, and `POST /api/v1/hooks/{id}/rotate` replaces a secret with a
24-hour window in which both sign. It also cuts `targetUrl` to its origin in
`GET /api/v1/hooks` for any key that is not owner or admin (D831a). Against a Keel
deployment without these, `rotate` answers 404 and `list` returns full URLs as before.

### Changed

- **Breaking for member keys:** `keel_people` `create` now needs a key created by an
  owner or admin. A member's key gets 403 on `create`, including when the email already
  exists and the call would have updated that person. `list` and `get` still accept any
  key. `update` and `delete` already needed owner or admin.
- The `keel_people` description says so, and says that `create` on an existing manually
  added person replaces the whole profile, clearing any field you leave out.

### Added

- `scripts/forbidden-test.mjs`, run by `npm test`: a 403 on `keel_people` `create`
  reaches the client as an error carrying the API's own message.
- `keel_webhooks` `create` surfaces the subscription's signing `secret`, which
  `POST /api/v1/hooks` now returns once (keelgrc-v1, D827a). The result keeps every field
  the API sent and adds `secretNote`, which tells the model the secret is shown once and how
  a receiver verifies the `x-keel-signature` header. Against a Keel deployment that predates
  the change there is no `secret`, and the result is passed through unchanged. Additive.
- `scripts/webhook-secret-test.mjs`, run by `npm test`: `create` passes the secret through
  with the note, `list` output is untouched, and a response with no secret gets no note.
- `keel_webhooks` `rotate` (takes `id`, owner or admin): calls
  `POST /api/v1/hooks/{id}/rotate` with no body and returns the new `secret` and
  `previousSecretExpiresAt` with a `secretNote`, which says the secret is shown once and
  the old one keeps signing until the expiry (D829a, D830a). Additive.
- `scripts/webhook-secret-test.mjs` covers `rotate`: the path, the empty body, the fields
  passed through, the note, and the refusals for a missing `id` or a stray argument.

### Changed (D827a)

- The `keel_webhooks` description no longer says the signing secret is never returned.
  It says `create` returns it once and describes how to verify a delivery.
- The `keel_webhooks` description and the create note describe the D829a contract:
  `x-keel-signature: v1=<hex>`, two comma-separated values during a rotation window,
  accept if any `v1=` value matches, and deduplicate on `x-keel-event-id`. They also name
  `x-keel-subscription-id`, and the description says `list` shows only the origin of
  `targetUrl` to a key that is not owner or admin (D831a).

## 0.6.0

Paired with the keelgrc-v1 change that adds `POST /api/v1/controls` and embeds `crosswalks`
in `GET /api/v1/controls/{id}` (D805). This release needs a Keel deployment that has them;
against an older one, `create` answers 405 and `get` returns no `crosswalks`.

### Added

- `keel_controls` `create`: one custom control, as the app's "Add a control" does. Takes
  `name` (required), `description` and `key`, your own identifier for the control. Omit
  `key` and Keel generates one. A key the workspace already uses fails with the existing
  control in the error, and nothing is overwritten. The new control starts `not_started`
  with no owner and no mappings. Owner or admin.
- `keel_controls` `get` returns `crosswalks`, the clauses the control is mapped to, in the
  same shape `mappings` returns them. `list` does not carry them.

### Changed

- The `keel_controls` description no longer says there is no create for a single control.

## 0.5.0

Paired with the keelgrc-v1 change that adds the endpoints below (D781, D782, D784). This
release needs a Keel deployment that has them; against an older one, the new actions
answer 404.

### Added

- `keel_starter_controls`: adds a framework's recommended controls, already mapped to
  its clauses, through `POST /api/v1/frameworks/{key}/starter-controls`. It does what
  the "Add recommended controls" button does, and a repeat call adds nothing. Owner or
  admin, and only for a framework the workspace has applied.
- `keel_controls` gains `mappings`, `map` and `unmap`, over
  `/api/v1/controls/{id}/crosswalks`. `map` takes a `frameworkKey` and a
  `requirementRef` Keel authors for it, and refuses a section heading. `unmap` on a
  clause the control is not mapped to fails instead of reporting success. `map` and
  `unmap` need owner or admin.

### Changed

- `keel_risks`: `likelihood` and `impact` are optional on `create` and accept null on
  `update` (D784). A risk created without them is unscored, and `likelihood`, `impact`,
  `inherentScore` and `level` read back as null until someone scores it. Before, the
  tool required both and the API refused a create without them.
- The API now refuses unknown fields on `POST /api/v1/people`,
  `PATCH /api/v1/people/{id}` and `POST /api/v1/hooks` with a 400, as it already did for
  the other write routes. `keel_people` and `keel_webhooks` were already strict in
  0.4.0 and send only documented fields, so their inputs are unchanged.

### Fixed

- Every tool that puts an id or a framework key in the URL now refuses `""`, `"."` and
  `".."` with an error naming the value. Those three were sent unencoded, and the
  request resolved to a different `/api/v1` path: `keel_controls` `mappings` with an id
  of `".."` called `/api/v1/crosswalks`. Any other value is percent-encoded as before.
