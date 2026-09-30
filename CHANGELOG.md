# Changelog

## Unreleased

Paired with the keelgrc-v1 change that moves `POST /api/v1/people` from "any role except
auditor" to owner or admin (D824). The role check is on the Keel side, so it applies to
every version of this server as soon as that change deploys.

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
