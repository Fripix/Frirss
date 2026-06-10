// Augment Express's Request with the fields our auth middleware attaches
// (set by requireAuth — every route that reads them runs behind it).
import 'express';
import type { AuthedUser } from './types.js';

declare global {
  namespace Express {
    interface Request {
      user: AuthedUser;
      token: string;
    }
  }
}
