
import "dotenv/config";

import { auth } from "../config/auth.js";

/**
 * Cookie names Better Auth uses for the session token.
 *
 * The plain name is issued over http (local development) and the `__Secure-`
 * prefixed one over https (production). `__Host-` is included for
 * completeness — Better Auth strips either prefix before matching.
 */
const SESSION_COOKIE_NAME = "better-auth.session_token";
const SESSION_COOKIE_NAMES = [
  `__Secure-${SESSION_COOKIE_NAME}`,
  SESSION_COOKIE_NAME,
  `__Host-${SESSION_COOKIE_NAME}`,
];

function parseCookieHeader(header) {
  const cookies = new Map();

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name) {
      cookies.set(name, value);
    }
  }

  return cookies;
}

/**
 * Finds the session token whatever prefix the browser sent and returns a
 * Cookie header that exposes it under every name this server may look for.
 *
 * That keeps verification working when the frontend and the API disagree on
 * the prefix (e.g. `BETTER_AUTH_URL` pointing at an http URL while the app is
 * served over https) instead of silently returning 401.
 */
function buildSessionCookieHeader(rawHeader) {
  const cookies = parseCookieHeader(rawHeader);

  let token = null;

  for (const name of SESSION_COOKIE_NAMES) {
    const value = cookies.get(name);

    if (value) {
      token = value;
      break;
    }
  }

  if (!token) {
    for (const [name, value] of cookies) {
      const baseName = name.startsWith("__Secure-")
        ? name.slice("__Secure-".length)
        : name.startsWith("__Host-")
          ? name.slice("__Host-".length)
          : null;

      if (baseName === SESSION_COOKIE_NAME && value) {
        token = value;
        break;
      }
    }
  }

  if (!token) {
    return null;
  }

  cookies.set(SESSION_COOKIE_NAME, token);
  cookies.set(`__Secure-${SESSION_COOKIE_NAME}`, token);

  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Verifies the Better Auth session attached to the request.
 *
 * The session cookie is issued by the frontend, but the browser only sends it
 * to the frontend origin, so the API resolves the session itself: the two
 * apps share `BETTER_AUTH_SECRET` and the same MongoDB database, which is
 * enough to validate the signed cookie and load the session. No cross-origin
 * callback and no extra network hop are needed.
 *
 * On success `req.user` / `req.session` are populated exactly as before, so
 * `requireRole()` and every protected route keep working unchanged.
 */
export async function verifyAuth(req, res, next) {
  try {
    const cookie = req.headers.cookie;

    if (!cookie) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please login first.",
      });
    }

    const sessionCookieHeader = buildSessionCookieHeader(cookie);

    if (!sessionCookieHeader) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please login first.",
      });
    }

    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;

      headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }

    headers.set("cookie", sessionCookieHeader);

    const sessionData = await auth.api.getSession({ headers });

    if (!sessionData?.user || !sessionData?.session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session. Please login again.",
      });
    }

    req.user = sessionData.user;
    req.session = sessionData.session;

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication verification failed",
    });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
}
