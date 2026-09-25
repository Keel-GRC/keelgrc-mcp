# Changelog

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
