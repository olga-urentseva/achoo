import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  getNearestPlace,
  searchPlaces,
} from "../controllers/places.controller.js";
import { nearestQuerySchema, placeSearchQuerySchema } from "../schemas.js";

export const placesRoutes = new Hono();

placesRoutes.get(
  "/search",
  zValidator("query", placeSearchQuerySchema),
  searchPlaces,
);

placesRoutes.get(
  "/nearest",
  zValidator("query", nearestQuerySchema),
  getNearestPlace,
);
