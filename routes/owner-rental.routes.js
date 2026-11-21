
import express from "express";
import { ObjectId } from "mongodb";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

// Owner authentication
router.use(verifyAuth, requireRole("owner"));

// GET: Owner's rental requests
router.get("/my-requests", async (req, res) => {
  try {
    const rentalCollection = getCollection("rental");

    const rentals = await rentalCollection
      .find({ ownerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Rental requests fetched successfully",
      data: rentals,
    });
  } catch (error) {
    console.error("Owner rentals fetching error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch rental requests",
    });
  }
});

// PATCH: Approve rental request
router.patch("/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
    }

    const rentalCollection = getCollection("rental");

    const result = await rentalCollection.updateOne(
      {
        _id: new ObjectId(id),
        ownerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          status: "approved",
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pending rental request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Rental request approved successfully",
    });
  } catch (error) {
    console.error("Rental approval error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to approve rental request",
    });
  }
});

// PATCH: Reject rental request
router.patch("/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
    }

    const rentalCollection = getCollection("rental");

    const result = await rentalCollection.updateOne(
      {
        _id: new ObjectId(id),
        ownerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          status: "rejected",
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pending rental request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Rental request rejected successfully",
    });
  } catch (error) {
    console.error("Rental rejection error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to reject rental request",
    });
  }
});

export default router;
