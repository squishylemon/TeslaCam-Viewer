export const LEGACY_VEHICLE_SUFFIX = '_root';

export function encodeVehicleId(locationId: string, folderId: string): string {
  if (!locationId) return folderId;
  const folder = folderId || LEGACY_VEHICLE_SUFFIX;
  return `${locationId}::${folder}`;
}

export function decodeVehicleId(vehicleId: string): { locationId: string; folderId: string } {
  const idx = vehicleId.indexOf('::');
  if (idx < 0) {
    return { locationId: 'builtin', folderId: vehicleId };
  }
  const folder = vehicleId.slice(idx + 2);
  return {
    locationId: vehicleId.slice(0, idx),
    folderId: folder === LEGACY_VEHICLE_SUFFIX ? '' : folder,
  };
}
