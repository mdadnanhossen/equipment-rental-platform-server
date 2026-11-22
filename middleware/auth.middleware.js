
import "dotenv/config";

export async function verifyAuth(req, res, next) {
  try {
    const authBaseURL = (
      process.env.BETTER_AUTH_URL || "http://localhost:3000"
    ).replace(/\/+$/, "");

    const cookie = req.headers.cookie;

    if (!cookie || !cookie.includes("better-auth.session_token")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please login first.",
      });
    }

    const response = await fetch(
      `${authBaseURL}/api/auth/get-session`,
      {
        method: "GET",
        headers: {
          Cookie: cookie,
        },
      }
    );

    if (!response.ok) {
      console.error(
        "Better Auth verification failed:",
        response.status,
        authBaseURL
      );

      return res.status(401).json({
        success: false,
        message: "Invalid or expired session. Please login again.",
      });
    }

    const sessionData = await response.json();

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
