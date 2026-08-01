// Hazards[].HazardType is empty in 100% of CPSC records (verified across 9,927 records
// on 2026-07-31), so we classify the prose ourselves. Ordered: most severe first.

export const HAZARD_RULES = [
  { type: "tip_over",    re: /tip[- ]?over|topple|entrapment|unstable/i,                     label: "Tip-Over / Crush",  color: "#E5484D" },
  { type: "fire_burn",   re: /\bfire\b|burn|overheat|thermal|flammab|ignit|explos/i,          label: "Fire / Burn",       color: "#F76B15" },
  { type: "battery",     re: /lithium|battery|batteries|power bank|charger/i,                 label: "Battery",           color: "#FFB224" },
  { type: "choking",     re: /chok|small part|ingest|aspirat|swallow/i,                       label: "Choking",           color: "#E5484D" },
  { type: "suffocation", re: /suffocat|strangulat|asphyxi|entangle/i,                         label: "Suffocation",       color: "#E5484D" },
  { type: "fall",        re: /\bfall\b|falls|collapse|detach|break.*(?:under|weight)/i,       label: "Fall",              color: "#F76B15" },
  { type: "laceration",  re: /lacerat|\bcut\b|sharp|amputat|blade/i,                          label: "Laceration",        color: "#F76B15" },
  { type: "chemical",    re: /\blead\b|phthalate|cadmium|toxic|poison|chemical|mold/i,        label: "Toxic / Chemical",  color: "#8E4EC6" },
  { type: "drowning",    re: /drown/i,                                                         label: "Drowning",          color: "#E5484D" },
  { type: "impact",      re: /impact|projectil|struck|blunt/i,                                label: "Impact",            color: "#F76B15" },
  { type: "electrical",  re: /shock|electrocut|electrical/i,                                  label: "Electrical",        color: "#FFB224" },
] as const;

export type HazardType = (typeof HAZARD_RULES)[number]["type"] | "other";

export function classifyHazard(text: string): { type: HazardType; label: string; color: string } {
  return HAZARD_RULES.find((r) => r.re.test(text)) ?? { type: "other", label: "Other", color: "#7C7F88" };
}
