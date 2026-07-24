import passport from "passport";
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from "passport-google-oauth20";
import { env, googleCallbackUrl, googleAuthEnabled } from "./env.js";
import {
  findUserByGoogleId,
  findUserByEmail,
  createUserFromGoogle,
  linkGoogleAccount,
} from "../models/auth.model.js";

// Only registered when real credentials are present — same optional-feature
// pattern as Stripe/eSewa/Khalti/Fonepay in env.ts. If it's off, the routes
// that use `passport.authenticate("google", ...)` will 500 if hit directly,
// which is why auth.routes.ts guards them with `googleAuthEnabled` too.
if (googleAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: googleCallbackUrl,
      },
      async (_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Your Google account doesn't have a public email address."));
          }

          let user = await findUserByGoogleId(profile.id);

          if (!user) {
            // No account linked to this Google ID yet. If an account with
            // the same email already exists (e.g. they originally signed up
            // with a password), link Google to it instead of creating a
            // duplicate user — Google has already verified this email, so
            // linking is safe.
            const existing = await findUserByEmail(email);
            user = existing
              ? await linkGoogleAccount(existing.id, profile.id)
              : await createUserFromGoogle(
                  email,
                  profile.id,
                  profile.displayName,
                  profile.photos?.[0]?.value,
                );
          }

          if (user.deletedAt || !user.isActive) {
            return done(new Error("This account is no longer active."));
          }

          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );
}

export default passport;