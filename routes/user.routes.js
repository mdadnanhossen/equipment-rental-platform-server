
import express from "express";
import { ObjectId } from "mongodb";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth, requireRole("admin"));

const ROLES = ["customer", "owner", "admin"];

/**
 * GET /api/users
 * Admin: list every registered user (including registration date).
 */
router.get("/", async (req, res) => {
  try {
    const userCollection = getCollection("user");

    const { search = "" } = req.query;

    const filter = {};

    if (search && typeof search === "string" && search.trim()) {
      const regex = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

      filter.$or = [{ name: regex }, { email: regex }];
    }

    const users = await userCollection
      .find(filter)
      .project({
        name: 1,
        email: 1,
        role: 1,
        image: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: users.map((user) => ({
        ...user,
        _id: user._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Users fetching error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

/**
 * PATCH /api/users/:id/role
 * Admin: change a user's role.
 */
router.patch("/:id/role", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (!ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    // Admins cannot demote themselves (prevents locking out the last admin).
    if (id.toString() === req.user.id && role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own role",
      });
    }

    const userCollection = getCollection("user");

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          role,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User role updated successfully",
      data: {
        id,
        role,
      },
    });
  } catch (error) {
    console.error("User role update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user role",
    });
  }
});

export default router;
