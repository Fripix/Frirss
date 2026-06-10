// Shared server-side types.

export interface AuthedUser {
  id: number;
  username: string;
  email?: string | null;
  display_name?: string;
  role: string;
  active?: number;
  auth_provider?: string;
}
