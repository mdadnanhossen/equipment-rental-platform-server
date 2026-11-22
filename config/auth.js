import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

import { connectToDatabase, getDatabase } from "./database.js";

let authInstance = null;

export function getAuth() {
  if (!authInstance) {
    authInstance = betterAuth({
      database: mongodbAdapter(getDatabase()),
      trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
      secret: process.env.BETTER_AUTH_SECRET,
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
 * Safe to call multiple times: the instance is created only once.
 */
export async function initializeAuth() {
  await connectToDatabase();
  return getAuth();
}

export const auth = new Proxy({}, {
  get(target, prop) {
    return getAuth()[prop];
  }
});
