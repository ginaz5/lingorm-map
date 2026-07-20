import { createHash } from 'node:crypto';

export const FORMAL_PROPERTY_RETIREMENT_URL = new URL(
  '../docs/location-verification-formal-property-retirement-20260720.json',
  import.meta.url
);

export const RETIRED_FORMAL_LOCATION_PROPERTIES = Object.freeze([
  'Candidate Summary',
  'Candidate Maps URL',
  'Candidate Payload',
  'Review Decision',
  'Apply Metadata',
  'Origin',
  'Coordinate Type',
  'Place ID Checked At',
]);

export const RETIRED_IMMUTABLE_FORMAL_FIELDS = Object.freeze(['Origin']);

export const FORMAL_PROPERTY_DROP_STATEMENTS =
  RETIRED_FORMAL_LOCATION_PROPERTIES.map(
    (property) => `DROP COLUMN "${property}"`
  ).join('; ');

export function sha256Json(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')}`;
}

export function formalPropertyRetirementPlanContent(artifact) {
  return {
    migrationId: artifact.migrationId,
    formalDataSourceId: artifact.formalDataSourceId,
    sourceCutoverBaselineId: artifact.sourceCutoverBaselineId,
    sourceCutoverContentSha256: artifact.sourceCutoverContentSha256,
    retiredProperties: artifact.retiredProperties,
    archiveSha256: artifact.archiveSha256,
    pagePatches: artifact.pagePatches,
    dropStatements: artifact.dropStatements,
  };
}
