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
  updatedAt: string;
};

export type BhcRecordTombstoneRow = {
  id: string;
  ownerId: string;
  deletedAt: string;
};

export type BhcCatalogNumberRow = {
  sequence: number;
  recordId: string;
  ownerId: string;
  createdAt: string;
};

export type BhcPendingMediaDeletionRow = {
  r2Key: string;
  mediaId: string;
  recordId: string;
  ownerId: string;
  requestedAt: string;
  attempts: number;
  lastError: string | null;
};

export type BhcPendingMediaUploadRow = BhcPendingMediaDeletionRow;
