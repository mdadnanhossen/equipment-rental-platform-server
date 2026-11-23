import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

import { connectToDatabase, getDatabase } from "./database.js";

let authInstance = null;
let boundDatabase = null;

const isProduction = process.env.NODE_ENV === "production";

/**
 * Better Auth instance used by this API to *verify* sessions that were
 * created by the frontend (the frontend owns `/api/auth`).
 *
 * It must stay byte-for-byte compatible with the frontend instance:
 *  - the same `BETTER_AUTH_SECRET` (the session cookie is signed with it),
 *  - the same database (`DB_NAME`),
 *  - the same `user.additionalFields.role` (otherwise `role` is stripped from
 *    the session user and every `requireRole()` guard would fail),
 *  - the same cookie name, which is forced with `useSecureCookies`
 *    (`__Secure-better-auth.session_token` in production,
 *     `better-auth.session_token` in development).
 */
export function getAuth() {
  const database = getDatabase();

  // Rebuild the instance whenever the underlying Mongo handle changes
  // (reconnect after a dropped connection, closeDatabaseConnection(), ...):
  // an adapter bound to a closed topology throws MongoTopologyClosedError.
  if (!authInstance || boundDatabase !== database) {
    boundDatabase = database;

    authInstance = betterAuth({
      database: mongodbAdapter(database),
      secret: process.env.BETTER_AUTH_SECRET,
      advanced: {
        useSecureCookies: isProduction,
      },
      trustedOrigins: [
        process.env.CLIENT_URL,
        process.env.BETTER_AUTH_URL,
        // Local development origin (only relevant outside production).
        ...(isProduction ? [] : ["http://localhost:3000"]),
      ].filter(Boolean),
      user: {
        additionalFields: {
          role: {
            type: ["admin", "owner", "customer"],
            required: true,
            input: false,
            defaultValue: "customer",
          },
        },
      },
      emailAndPassword: {
        enabled: true,
      },
      session: {
        cookieCache: {
          enabled: true,
          maxAge: 60 * 60 * 24 * 7,
        },
      },
    });
  }

  return authInstance;
}

/**
 * Initializes Better Auth, making sure MongoDB is connected first.
 * Safe to call multiple times: the instance is created only once per
 * database handle.
 */
export async function initializeAuth() {
  await connectToDatabase();
  return getAuth();
}

export const auth = new Proxy({}, {
  get(target, prop) {
    return getAuth()[prop];
  },
  has() {
    return true;
  },
});
