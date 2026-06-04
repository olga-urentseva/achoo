import type { Allergen } from "../db/schema.js";

/**
 * Pollen cross-reactivity reference data — which allergens share a protein
 * family, so a sensitivity to one often comes with sensitivity to the others.
 *
 * This is public, non-personal reference data (botany/immunology, the same
 * for everyone). The client combines it with the user's own allergen list —
 * which lives only in their browser's localStorage, never on the server — to
 * suggest allergens they may also react to. No health profile is stored
 * server-side, so this keeps recommendations out of regulated-data territory.
 *
 * `strength` ranks how strongly the shared protein drives cross-reactivity,
 * so the client can rank or filter suggestions (e.g. surface "strong" first,
 * treat "weak" profilin links as hints only).
 */
export type CrossReactivityStrength = "strong" | "moderate" | "weak";

export interface CrossReactivityGroup {
  /** The shared molecule/protein family that explains the cross-reactivity. */
  protein: string;
  /** Human-readable family label for showing the user "why". */
  family: string;
  strength: CrossReactivityStrength;
  /** Allergens that share this protein; every value is a known `Allergen`. */
  allergens: readonly Allergen[];
}

export const CROSS_REACTIVITY: readonly CrossReactivityGroup[] = [
  {
    protein: "Bet v 1 (PR-10)",
    family: "Fagales tree pollen",
    strength: "strong",
    // Birch, alder, hazel and oak share the Bet v 1 protein; reacting to one
    // commonly means reacting to the others.
    allergens: ["birch", "alder", "hazel", "oak"],
  },
  {
    protein: "Artemisia / Ambrosia weed group",
    family: "Weed pollen",
    strength: "moderate",
    allergens: ["mugwort", "ragweed"],
  },
  {
    protein: "Profilin",
    family: "Panallergen (broad, usually mild)",
    strength: "weak",
    // Profilin is a minor panallergen found across unrelated pollens. It links
    // birch to grass, weeds and olive, but the reactions are typically mild —
    // hence the "weak" ranking. (This is the birch↔grass link.)
    allergens: ["birch", "grass", "mugwort", "ragweed", "olive"],
  },
] as const;
