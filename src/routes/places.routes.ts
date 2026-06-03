import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { searchPlaces } from "../controllers/places.controller.js";
import { placeSearchQuerySchema } from "../schemas.js";

export const placesRoutes = new Hono();

placesRoutes.get(
  "/search",
  zValidator("query", placeSearchQuerySchema),
  searchPlaces,
);
