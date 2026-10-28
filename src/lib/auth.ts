import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins/username";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import * as authSchema from "@/db/auth-schema";
import { user } from "@/db/auth-schema";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    // Accounts are created by admins/managers only.
    disableSignUp: true,
    minPasswordLength: 6,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "employee", input: false },
      active: { type: "boolean", required: false, defaultValue: true, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated users cannot log in.
        before: async (s) => {
          const u = await db.query.user.findFirst({ where: eq(user.id, s.userId) });
          if (!u?.active) throw new APIError("FORBIDDEN", { message: "Account is deactivated" });
        },
      },
    },
  },
  plugins: [username({ minUsernameLength: 3 }), nextCookies()],
});
