/**
 * Logical D1 schema for BHC Field. The deployable migration is kept in
 * drizzle/0000_bhcm_field.sql so the app can run without a build dependency.
 */
export type BhcRecordRow = {
  id: string;
  ownerId: string;
  entityType: "specimen";
  publicationStatus: "draft" | "ready" | "published" | "withheld";
  dataJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type BhcMediaRow = {
  id: string;
  recordId: string;
  ownerId: string;
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  photoType: string;
  photoLabel: string | null;
  orientation: string | null;
  captureJson: string;
  createdAt: string;
};
