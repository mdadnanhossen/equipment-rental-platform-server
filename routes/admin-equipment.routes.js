
import express from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../config/database.js";

import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

// All admin routes require admin authentication
router.use(verifyAuth, requireRole("admin"));

/**
 * GET /
 * Admin: Get all equipment
 *
 * Optional filters:
 * ?status=pending
 * ?status=approved
 * ?status=rejected
 * ?search=camera
 */
router.get("/", async (req, res) => {
  try {
    const collection = getCollection("equipment");

    const {
      status,
      search,
      page = "1",
      limit = "12",
    } = req.query;

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(50, Math.max(1, Number(limit) || 12));

    const filter = {};

    if (status) {
      const allowedStatuses = [
        "pending",
        "approved",
        "rejected",
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment status",
        });
      }

      filter.status = status;
    }

    if (search && typeof search === "string") {
      const safeSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const regex = new RegExp(safeSearch.trim(), "i");

      filter.$or = [
        { title: regex },
        { category: regex },
        { ownerName: regex },
        { ownerId: regex },
      ];
    }

    const skip = (currentPage - 1) * pageLimit;

    const [equipment, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit)
        .toArray(),

      collection.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      message: "All equipment fetched successfully",
      data: equipment.map((item) => ({
        ...item,
        _id: item._id.toString(),
      })),
      total,
      page: currentPage,
      totalPages: Math.ceil(total / pageLimit),
    });
  } catch (error) {
    console.error("Admin equipment fetching error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

/**
 * GET /pending
 * Admin: Get pending equipment
 */
router.get("/pending", async (req, res) => {
  try {
    const collection = getCollection("equipment");

    const equipment = await collection
      .find({ status: "pending" })
      .sort({ createdAt: 1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Pending equipment fetched successfully",
      data: equipment.map((item) => ({
        ...item,
        _id: item._id.toString(),
      })),
      total: equipment.length,
    });
  } catch (error) {
    console.error("Pending equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch pending equipment",
    });
  }
});

/**
 * PATCH /:id/approve
 * Admin: Approve equipment
 */
router.patch("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const collection = getCollection("equipment");

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        status: "pending",
      },
      {
        $set: {
          status: "approved",
          rejectionReason: "",
          approvedAt: new Date(),
          approvedBy: req.user.id,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Pending equipment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Equipment approved successfully",
      data: {
        ...result,
        _id: result._id.toString(),
      },
    });
  } catch (error) {
    console.error("Equipment approval error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to approve equipment",
    });
  }
});

/**
 * PATCH /:id/reject
 * Admin: Reject equipment
 */
router.patch("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    if (
      typeof reason !== "string" ||
      !reason.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    const collection = getCollection("equipment");

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        status: "pending",
      },
      {
        $set: {
          status: "rejected",
          rejectionReason: reason.trim(),
          rejectedAt: new Date(),
          rejectedBy: req.user.id,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Pending equipment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Equipment rejected successfully",
      data: {
        ...result,
        _id: result._id.toString(),
      },
    });
  } catch (error) {
    console.error("Equipment rejection error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to reject equipment",
    });
  }
});

export default router;
