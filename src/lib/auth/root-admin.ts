/** Reserved database id for the seeded default administrator. */
export const ROOT_ADMIN_ID = 1;

export const ROOT_ADMIN_USERNAME = 'admin';

export function isRootAdminUser(userId: number): boolean {
  return userId === ROOT_ADMIN_ID;
}
