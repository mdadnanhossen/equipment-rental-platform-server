
import express from "express";
import { ObjectId } from "mongodb";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth, requireRole("customer"));

/**
 * GET /api/favorites
 * Customer: list favorites joined with current equipment data.
 */
router.get("/", async (req, res) => {
  try {
    const favoriteCollection = getCollection("favorite");
    const equipmentCollection = getCollection("equipment");

    const favorites = await favoriteCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const equipmentIds = favorites
      .map((favorite) => favorite.equipmentId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const equipmentDocuments =
      equipmentIds.length > 0
        ? await equipmentCollection
            .find({ _id: { $in: equipmentIds } })
            .toArray()
        : [];

    const equipmentById = new Map(
      equipmentDocuments.map((item) => [
        item._id.toString(),
        item,
      ])
    );

    const data = favorites
      .map((favorite) => {
        const equipment = equipmentById.get(favorite.equipmentId);

        if (!equipment) {
          return null;
        }

        return {
          favoriteId: favorite._id.toString(),
          equipment: {
            ...equipment,
            pricePerDay: Number.isFinite(equipment.pricePerDay)
              ? equipment.pricePerDay
              : Number(
                  equipment.pricePerWeek ?? equipment.pricePerMonth ?? 0
                ),
            rentalType: equipment.rentalType || "daily",
            quantity: Number.isInteger(equipment.quantity)
              ? equipment.quantity
              : 1,
            rentalTerms:
              typeof equipment.rentalTerms === "string"
                ? equipment.rentalTerms
                : "",
            _id: equipment._id.toString(),
          },
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      message: "Favorites fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Fetching favorites error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch favorites",
    });
  }
});

/**
 * POST /api/favorites
 * Customer: add equipment to favorites.
 */
router.post("/", async (req, res) => {
  try {
    const { equipmentId } = req.body;

    if (!equipmentId || !ObjectId.isValid(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "Valid equipment ID is required",
      });
    }

    const favoriteCollection = getCollection("favorite");
    const equipmentCollection = getCollection("equipment");

    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(equipmentId),
      status: "approved",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    await favoriteCollection.updateOne(
      {
        customerId: req.user.id,
        equipmentId: equipmentId.toString(),
      },
      {
        $set: {
          customerId: req.user.id,
          equipmentId: equipmentId.toString(),
          equipmentTitle: equipment.title,
          equipmentImage: equipment.images?.[0]?.url || "",
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return res.status(201).json({
      success: true,
      message: "Added to favorites",
    });
  } catch (error) {
    console.error("Adding favorite error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add favorite",
    });
  }
});

/**
 * DELETE /api/favorites/:equipmentId
 * Customer: remove equipment from favorites.
 */
router.delete("/:equipmentId", async (req, res) => {
  try {
    const { equipmentId } = req.params;

    if (!ObjectId.isValid(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const favoriteCollection = getCollection("favorite");

    const result = await favoriteCollection.deleteOne({
      customerId: req.user.id,
      equipmentId: equipmentId.toString(),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Favorite not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Removed from favorites",
    });
  } catch (error) {
    console.error("Removing favorite error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove favorite",
    });
  }
});

export default router;
