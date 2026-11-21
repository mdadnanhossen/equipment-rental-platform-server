
export const RENTAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "active",
  "completed",
  "cancelled",
];

export const PAYMENT_STATUSES = [
  "unpaid",
  "paid",
  "refunded",
];

export function validateRentalPayload(payload) {
  const errors = [];

  if (!payload.equipmentId) {
    errors.push("Equipment ID is required");
  }

  if (!payload.startDate) {
    errors.push("Start date is required");
  }

  if (!payload.endDate) {
    errors.push("End date is required");
  }

  const startDate = new Date(payload.startDate);
  const endDate = new Date(payload.endDate);

  if (
    payload.startDate &&
    Number.isNaN(startDate.getTime())
  ) {
    errors.push("Invalid start date");
  }

  if (
    payload.endDate &&
    Number.isNaN(endDate.getTime())
  ) {
    errors.push("Invalid end date");
  }

  if (
    !Number.isNaN(startDate.getTime()) &&
    !Number.isNaN(endDate.getTime()) &&
    endDate <= startDate
  ) {
    errors.push("End date must be after start date");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
