import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as WishlistModel from "../models/wishlist.model.js";
import { getTripById } from "../models/trip.model.js";

export async function getMyWishlist(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const wishlist = await WishlistModel.listWishlist(req.user.userId);
    res.json({ status: "success", data: wishlist });
  } catch (err) {
    next(err);
  }
}

export async function addToWishlist(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const tripId = requireStringParam(req.params.tripId);

    const trip = await getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");

    const existing = await WishlistModel.findWishlistEntry(req.user.userId, tripId);
    if (existing) throw ApiError.conflict("Trip is already in your wishlist");

    const entry = await WishlistModel.addToWishlist(req.user.userId, tripId);
    res.status(201).json({ status: "success", data: entry });
  } catch (err) {
    next(err);
  }
}

export async function removeFromWishlist(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const tripId = requireStringParam(req.params.tripId);

    const existing = await WishlistModel.findWishlistEntry(req.user.userId, tripId);
    if (!existing) throw ApiError.notFound("Trip is not in your wishlist");

    await WishlistModel.removeFromWishlist(req.user.userId, tripId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
