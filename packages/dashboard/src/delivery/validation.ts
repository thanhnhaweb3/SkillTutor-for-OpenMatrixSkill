import { DeliveryDomainError } from "./errors";
const text = (value: string, field: string, min: number, max: number) => { const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max || /[<>\u0000-\u001F]/u.test(normalized)) throw new DeliveryDomainError("VALIDATION_ERROR", `Invalid ${field}`); return normalized; };
const date = (value: string, field: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new DeliveryDomainError("VALIDATION_ERROR", `Invalid ${field}`); return value; };
export function validateCohortInput(input: { name: string; startDate: string; endDate?: string }) { const startDate = date(input.startDate, "start date"), endDate = input.endDate ? date(input.endDate, "end date") : undefined;
  if (endDate && endDate < startDate) throw new DeliveryDomainError("VALIDATION_ERROR", "End date precedes start date");
  return { name: text(input.name, "cohort name", 2, 120), startDate, endDate }; }
