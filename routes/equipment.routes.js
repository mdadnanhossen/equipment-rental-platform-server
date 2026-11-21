
import express from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../config/database.js";
import upload from "../middleware/upload.middleware.js";
import cloudinary from "../config/cloudinary.js";

import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

import {
  validateEquipmentPayload,
} from "../models/equipment.model.js";

const router = express.Router();

const RENTAL_TYPES = ["daily", "weekly", "monthly"];

const PRICE_FIELDS = {
  daily: "pricePerDay",
  weekly: "pricePerWeek",
  monthly: "pricePerMonth",
};

// Escape special regex characters in search input
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * POST /api/equipment
 * Owner: Create a new equipment listing
 */
router.post(
  "/",
  verifyAuth,
  requireRole("owner"),
  async (req, res) => {
    try {
      const errors = validateEquipmentPayload(req.body);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment information",
          errors,
        });
      }

      const collection = getCollection("equipment");

      const {
        title,
        description,
        category,
        brand,
        model,
        rentalType = "daily",
        pricePerDay,
        pricePerWeek,
        pricePerMonth,
        securityDeposit,
        condition,
        images,
        location,
      } = req.body;

      const selectedPriceField = PRICE_FIELDS[rentalType];

      const selectedPrice = {
        pricePerDay,
        pricePerWeek,
        pricePerMonth,
      }[selectedPriceField];

      const newEquipment = {
        title: title.trim(),
        description: description.trim(),
        category: category.trim(),

        brand: brand?.trim() || "",
        model: model?.trim() || "",

        rentalType,
        [selectedPriceField]: selectedPrice,

        securityDeposit: securityDeposit ?? 0,

        condition,

        images: images.map((image) => ({
          url: image.url.trim(),
          ...(image.publicId
            ? { publicId: image.publicId }
            : {}),
        })),

        location: {
          city: location.city.trim(),
          address: location.address.trim(),
        },

        // Server-controlled fields
        availability: "available",
        status: "pending",

        ownerId: req.user.id,
        ownerName: req.user.name || "Equipment Owner",

        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await collection.insertOne(newEquipment);

      return res.status(201).json({
        success: true,
        message:
          "Equipment submitted successfully. Waiting for admin approval.",
        data: {
          ...newEquipment,
          _id: result.insertedId.toString(),
        },
      });
    } catch (error) {
      console.error("Equipment creation error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to create equipment",
      });
    }
  }
);


// GET /api/equipment
// Public: Get approved equipment with search and filters
router.get("/", async (req, res) => {
  try {
    const collection = getCollection("equipment");

    const {
      search,
      category,
      minPrice,
      maxPrice,
      sortBy = "newest",
      page = "1",
      limit = "12",
    } = req.query;

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(50, Math.max(1, Number(limit) || 12));

    const filter = {
      status: "approved",
    };

    if (search && typeof search === "string") {
      const searchRegex = new RegExp(
        escapeRegex(search.trim()),
        "i"
      );

      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
        { brand: searchRegex },
        { model: searchRegex },
      ];
    }

    if (category && typeof category === "string") {
      filter.category = {
        $regex: `^${escapeRegex(category.trim())}$`,
        $options: "i",
      };
    }

    // Price filtering currently uses daily prices.
    // Rental-type-aware filtering will be added in the All Equipment step.
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.pricePerDay = {};

      if (minPrice !== undefined) {
        const minimum = Number(minPrice);

        if (!Number.isFinite(minimum) || minimum < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid minimum price",
          });
        }

        filter.pricePerDay.$gte = minimum;
      }

      if (maxPrice !== undefined) {
        const maximum = Number(maxPrice);

        if (!Number.isFinite(maximum) || maximum < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid maximum price",
          });
        }

        filter.pricePerDay.$lte = maximum;
      }

      if (
        filter.pricePerDay.$gte !== undefined &&
        filter.pricePerDay.$lte !== undefined &&
        filter.pricePerDay.$gte > filter.pricePerDay.$lte
      ) {
        return res.status(400).json({
          success: false,
          message: "Minimum price cannot exceed maximum price",
        });
      }
    }

    const sortOptions = {
      newest: { createdAt: -1 },
      "price-low": { pricePerDay: 1 },
      "price-high": { pricePerDay: -1 },
    };

    const sort = sortOptions[sortBy];

    if (!sort) {
      return res.status(400).json({
        success: false,
        message: "Invalid sorting option",
      });
    }

    const skip = (currentPage - 1) * pageLimit;

    const [equipment, total] = await Promise.all([
      collection
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(pageLimit)
        .toArray(),

      collection.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: "Equipment fetched successfully",
      data: equipment.map((item) => ({
        ...item,
        rentalType: item.rentalType || "daily",
        _id: item._id.toString(),
      })),
      total,
      page: currentPage,
      totalPages: Math.ceil(total / pageLimit),
    });
  } catch (error) {
    console.error("Equipment fetching error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});


/**
 * GET /api/equipment/my-equipment
 * Owner: Get all equipment created by the logged-in owner
 */
router.get(
  "/my-equipment",
  verifyAuth,
  requireRole("owner"),
  async (req, res) => {
    try {
      const collection = getCollection("equipment");

      const {
        page = "1",
        limit = "12",
        status,
      } = req.query;

      const currentPage = Math.max(1, Number(page) || 1);
      const pageLimit = Math.min(50, Math.max(1, Number(limit) || 12));

      const filter = {
        ownerId: req.user.id,
      };

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

      return res.status(200).json({
        success: true,
        message: "Your equipment fetched successfully",
        data: equipment.map((item) => ({
          ...item,
          rentalType: item.rentalType || "daily",
          _id: item._id.toString(),
        })),
        total,
        page: currentPage,
        totalPages: Math.ceil(total / pageLimit),
      });
    } catch (error) {
      console.error("My equipment fetching error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch your equipment",
      });
    }
  }
);


/**
 * PATCH /api/equipment/:id
 * Owner: Update own equipment
 */
router.patch(
  "/:id",
  verifyAuth,
  requireRole("owner"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
      }

      const collection = getCollection("equipment");

      // Find equipment owned by the logged-in owner.
      const existingEquipment = await collection.findOne({
        _id: new ObjectId(id),
        ownerId: req.user.id,
      });

      if (!existingEquipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or you are not the owner",
        });
      }

      // Only allow these fields to be updated.
      const allowedFields = [
        "title",
        "description",
        "category",
        "brand",
        "model",
        "rentalType",
        "pricePerDay",
        "pricePerWeek",
        "pricePerMonth",
        "securityDeposit",
        "condition",
        "images",
        "location",
        "availability",
      ];

      const updates = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid fields provided for update",
        });
      }

      const validationErrors = [];

      // Text validation
      for (const field of [
        "title",
        "description",
        "category",
      ]) {
        if (
          updates[field] !== undefined &&
          (
            typeof updates[field] !== "string" ||
            !updates[field].trim()
          )
        ) {
          validationErrors.push(`Invalid ${field}`);
        }
      }

      for (const field of ["brand", "model"]) {
        if (
          updates[field] !== undefined &&
          typeof updates[field] !== "string"
        ) {
          validationErrors.push(`Invalid ${field}`);
        }
      }

      // Rental type validation
      const rentalType =
        updates.rentalType ??
        existingEquipment.rentalType ??
        "daily";

      if (!RENTAL_TYPES.includes(rentalType)) {
        validationErrors.push("Invalid rentalType");
      }

      // Validate every supplied price.
      for (const field of [
        "pricePerDay",
        "pricePerWeek",
        "pricePerMonth",
      ]) {
        if (
          updates[field] !== undefined &&
          (
            typeof updates[field] !== "number" ||
            !Number.isFinite(updates[field]) ||
            updates[field] <= 0
          )
        ) {
          validationErrors.push(`Invalid ${field}`);
        }
      }

      // The selected rental type must have a valid price.
      const selectedPriceField = PRICE_FIELDS[rentalType];

      const selectedPrice =
        updates[selectedPriceField] ??
        existingEquipment[selectedPriceField];

      if (
        selectedPriceField &&
        (
          typeof selectedPrice !== "number" ||
          !Number.isFinite(selectedPrice) ||
          selectedPrice <= 0
        )
      ) {
        validationErrors.push(
          `${selectedPriceField} must be a positive number`
        );
      }

      // Security deposit validation
      if (
        updates.securityDeposit !== undefined &&
        (
          typeof updates.securityDeposit !== "number" ||
          !Number.isFinite(updates.securityDeposit) ||
          updates.securityDeposit < 0
        )
      ) {
        validationErrors.push("Invalid securityDeposit");
      }

      // Condition validation
      if (
        updates.condition !== undefined &&
        !["new", "like-new", "good", "fair"].includes(
          updates.condition
        )
      ) {
        validationErrors.push("Invalid condition");
      }

      // Availability validation
      if (
        updates.availability !== undefined &&
        !["available", "unavailable"].includes(
          updates.availability
        )
      ) {
        validationErrors.push("Invalid availability");
      }

      // Image validation
      if (updates.images !== undefined) {
        if (
          !Array.isArray(updates.images) ||
          updates.images.some(
            (image) =>
              !image ||
              typeof image.url !== "string" ||
              !image.url.trim()
          )
        ) {
          validationErrors.push("Invalid images");
        }
      }

      // Location validation
      if (updates.location !== undefined) {
        if (
          !updates.location ||
          typeof updates.location.city !== "string" ||
          !updates.location.city.trim() ||
          typeof updates.location.address !== "string" ||
          !updates.location.address.trim()
        ) {
          validationErrors.push("Invalid location");
        }
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment information",
          errors: validationErrors,
        });
      }

      // Normalize text values.
      for (const field of [
        "title",
        "description",
        "category",
        "brand",
        "model",
      ]) {
        if (typeof updates[field] === "string") {
          updates[field] = updates[field].trim();
        }
      }

      if (updates.location) {
        updates.location = {
          city: updates.location.city.trim(),
          address: updates.location.address.trim(),
        };
      }

      if (updates.images) {
        updates.images = updates.images.map((image) => ({
          url: image.url.trim(),
          ...(image.publicId
            ? { publicId: image.publicId }
            : {}),
        }));
      }

      // Always persist a rental type and its selected price.
      updates.rentalType = rentalType;
      updates[selectedPriceField] = selectedPrice;

      // Remove prices belonging to other rental types.
      const unsetFields = {};

      for (const field of Object.values(PRICE_FIELDS)) {
        if (field !== selectedPriceField) {
          unsetFields[field] = "";
        }
      }

      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      // Changes to listing details or pricing require admin review.
      const requiresReview = [
        "title",
        "description",
        "category",
        "rentalType",
        "pricePerDay",
        "pricePerWeek",
        "pricePerMonth",
        "images",
        "location",
      ].some((field) => updates[field] !== undefined);

      const updateQuery = {
        $set: {
          ...updateData,
          ...(requiresReview
            ? {
                status: "pending",
                rejectionReason: "",
              }
            : {}),
        },
        $unset: unsetFields,
      };

      const result = await collection.findOneAndUpdate(
        {
          _id: new ObjectId(id),
          ownerId: req.user.id,
        },
        updateQuery,
        {
          returnDocument: "after",
        }
      );

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or you are not the owner",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Equipment updated successfully",
        data: {
          ...result,
          rentalType: result.rentalType || "daily",
          _id: result._id.toString(),
        },
      });
    } catch (error) {
      console.error("Equipment update error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update equipment",
      });
    }
  }
);


/**
 * DELETE /api/equipment/:id
 * Owner: Delete own equipment
 */
router.delete(
  "/:id",
  verifyAuth,
  requireRole("owner"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
      }

      const collection = getCollection("equipment");

      const result = await collection.deleteOne({
        _id: new ObjectId(id),
        ownerId: req.user.id,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or you are not the owner",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Equipment deleted successfully",
      });
    } catch (error) {
      console.error("Equipment deletion error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete equipment",
      });
    }
  }
);


/**
 * POST /api/equipment/upload-images
 * Owner: Upload equipment images to Cloudinary
 */
router.post(
  "/upload-images",
  verifyAuth,
  requireRole("owner"),
  upload.array("images", 5),
  async (req, res) => {
    const uploadedImages = [];

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one image",
        });
      }

      const uploadToCloudinary = (file) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "rentora/equipment",
              resource_type: "image",
            },
            (error, result) => {
              if (error) return reject(error);

              if (!result) {
                return reject(
                  new Error("Cloudinary returned no upload result")
                );
              }

              resolve({
                url: result.secure_url,
                publicId: result.public_id,
              });
            }
          );

          stream.end(file.buffer);
        });
      };

      for (const file of req.files) {
        const image = await uploadToCloudinary(file);
        uploadedImages.push(image);
      }

      return res.status(200).json({
        success: true,
        message: "Equipment images uploaded successfully",
        data: uploadedImages,
      });
    } catch (error) {
      console.error("Image upload error:", error);

      await Promise.allSettled(
        uploadedImages.map((image) =>
          cloudinary.uploader.destroy(image.publicId)
        )
      );

      return res.status(500).json({
        success: false,
        message: "Failed to upload equipment images",
      });
    }
  }
);


/**
 * GET /api/equipment/my-equipment/:id
 * Owner: Get one of their own equipment listings
 */
router.get(
  "/my-equipment/:id",
  verifyAuth,
  requireRole("owner"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
      }

      const equipment = await getCollection("equipment").findOne({
        _id: new ObjectId(id),
        ownerId: req.user.id,
      });

      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Equipment fetched successfully",
        data: {
          ...equipment,
          rentalType: equipment.rentalType || "daily",
          _id: equipment._id.toString(),
        },
      });
    } catch (error) {
      console.error("Owner equipment details error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch equipment",
      });
    }
  }
);


// GET /api/equipment/:id
// Public: Get one approved equipment
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const collection = getCollection("equipment");

    const equipment = await collection.findOne({
      _id: new ObjectId(id),
      status: "approved",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Equipment details fetched successfully",
      data: {
        ...equipment,
        rentalType: equipment.rentalType || "daily",
        _id: equipment._id.toString(),
      },
    });
  } catch (error) {
    console.error("Equipment details error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch equipment details",
    });
  }
});

export default router;
