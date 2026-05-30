export type LocationType = 'local' | 'smb';

export interface LibraryLocation {
  id: string;
  name: string;
  /** User-entered path (SMB share or host mount path). */
  path: string;
  type: LocationType;
  requiresCredentials: boolean;
  enabled: boolean;
  sortOrder: number;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryLocationInput {
  name: string;
  path: string;
  requiresCredentials?: boolean;
  username?: string;
  password?: string;
  enabled?: boolean;
}

export interface LibrarySettings {
  builtinSftpEnabled: boolean;
}

export const BUILTIN_LOCATION_ID = 'builtin';
