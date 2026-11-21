import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

let authInstance = null;

export function getAuth() {
  if (!authInstance) {
    const { getDatabase } = require("./database.js");
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

export const auth = new Proxy({}, {
  get(target, prop) {
    return getAuth()[prop];
  }
});