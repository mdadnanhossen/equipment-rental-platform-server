
export const EQUIPMENT_CONDITIONS = [
  "new",
  "like-new",
  "good",
  "fair",
];

export const EQUIPMENT_STATUSES = [
  "pending",
  "approved",
  "rejected",
];

export const EQUIPMENT_AVAILABILITY = [
  "available",
  "unavailable",
];

export const RENTAL_TYPES = [
  "daily",
  "weekly",
  "monthly",
];

export function validateEquipmentPayload(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return ["Invalid equipment data"];
  }

  const requiredFields = [
    "title",
    "description",
    "category",
  ];

  for (const field of requiredFields) {
    if (
      typeof data[field] !== "string" ||
      !data[field].trim()
    ) {
      errors.push(`${field} is required`);
    }
  }

  // Default old listings to daily rental.
  const rentalType = data.rentalType ?? "daily";

  if (!RENTAL_TYPES.includes(rentalType)) {
    errors.push("Invalid rental type");
  }

  // Validate the selected rental price.
  const priceFields = {
    daily: "pricePerDay",
    weekly: "pricePerWeek",
    monthly: "pricePerMonth",
  };

  const selectedPriceField = priceFields[rentalType];

  if (
    selectedPriceField &&
    (
      typeof data[selectedPriceField] !== "number" ||
      !Number.isFinite(data[selectedPriceField]) ||
      data[selectedPriceField] <= 0
    )
  ) {
    errors.push(
      `${selectedPriceField} must be a positive number`
    );
  }

  // Validate optional prices when provided.
  for (const field of [
    "pricePerDay",
    "pricePerWeek",
    "pricePerMonth",
  ]) {
    if (
      data[field] !== undefined &&
      (
        typeof data[field] !== "number" ||
        !Number.isFinite(data[field]) ||
        data[field] <= 0
      )
    ) {
      errors.push(`${field} must be a positive number`);
    }
  }

  if (
    data.securityDeposit !== undefined &&
    (
      typeof data.securityDeposit !== "number" ||
      !Number.isFinite(data.securityDeposit) ||
      data.securityDeposit < 0
    )
  ) {
    errors.push(
      "securityDeposit must be zero or a positive number"
    );
  }

  if (!EQUIPMENT_CONDITIONS.includes(data.condition)) {
    errors.push("Invalid equipment condition");
  }

  if (!Array.isArray(data.images)) {
    errors.push("Images must be an array");
  } else {
    for (const image of data.images) {
      if (
        !image ||
        typeof image.url !== "string" ||
        !image.url.trim()
      ) {
        errors.push("Each image must have a valid URL");
        break;
      }
    }
  }

  if (
    !data.location ||
    typeof data.location.city !== "string" ||
    !data.location.city.trim() ||
    typeof data.location.address !== "string" ||
    !data.location.address.trim()
  ) {
    errors.push("Valid city and address are required");
  }

  for (const field of ["brand", "model"]) {
    if (
      data[field] !== undefined &&
      typeof data[field] !== "string"
    ) {
      errors.push(`${field} must be a string`);
    }
  }

  return errors;
}
