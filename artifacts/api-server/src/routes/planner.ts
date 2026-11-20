import { getAuth } from "@clerk/express";
import {
  GetPlannerStateResponse,
  GetPlannerVersionParams,
  GetPlannerVersionResponse,
  ListPlannerVersionsResponse,
  SavePlannerStateBody,
  SavePlannerStateResponse,
} from "@workspace/api-zod";
import { db, plannerStateTable, plannerVersionTable } from "@workspace/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";

const router: IRouter = Router();

const requirePlannerAuth: RequestHandler = (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.userId = userId;
  next();
};

const userIdFromResponse = (res: Response): string =>
  String(res.locals.userId);

router.use(requirePlannerAuth);

router.get("/planner/state", async (_req, res): Promise<void> => {
  const userId = userIdFromResponse(res);
  const [state] = await db
    .select()
    .from(plannerStateTable)
    .where(eq(plannerStateTable.userId, userId))
    .limit(1);

  res.json(
    GetPlannerStateResponse.parse({
      exists: Boolean(state),
      revision: state?.revision ?? 0,
      updatedAt: state?.updatedAt.toISOString() ?? null,
      payload: state?.payload ?? null,
    }),
  );
});

router.put("/planner/state", async (req, res): Promise<void> => {
  const parsed = SavePlannerStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = userIdFromResponse(res);
  const result = await db.transaction(async (tx) => {
    // Serialize writes for this account, including the first snapshot when
    // there is not yet a row to lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const [current] = await tx
      .select()
      .from(plannerStateTable)
      .where(eq(plannerStateTable.userId, userId))
      .limit(1)
      .for("update");

    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== parsed.data.expectedRevision) {
      return { conflict: true as const, currentRevision };
    }

    const revision = currentRevision + 1;
    const now = new Date();

    if (current) {
      await tx
        .update(plannerStateTable)
        .set({
          revision,
          payload: parsed.data.payload,
          updatedAt: now,
        })
        .where(eq(plannerStateTable.userId, userId));
    } else {
      await tx.insert(plannerStateTable).values({
        userId,
        revision,
        payload: parsed.data.payload,
        updatedAt: now,
      });
    }

    await tx.insert(plannerVersionTable).values({
      userId,
      revision,
      payload: parsed.data.payload,
      createdAt: now,
    });

    if (revision > 50) {
      await tx
        .delete(plannerVersionTable)
        .where(
          and(
            eq(plannerVersionTable.userId, userId),
            lt(plannerVersionTable.revision, revision - 49),
          ),
        );
    }

    return {
      conflict: false as const,
      revision,
      updatedAt: now,
      payload: parsed.data.payload,
    };
  });

  if (result.conflict) {
    res.status(409).json({
      error: "Planner changed on another device",
      currentRevision: result.currentRevision,
    });
    return;
  }

  res.json(
    SavePlannerStateResponse.parse({
      revision: result.revision,
      updatedAt: result.updatedAt.toISOString(),
      payload: result.payload,
    }),
  );
});

router.get("/planner/versions", async (_req, res): Promise<void> => {
  const userId = userIdFromResponse(res);
  const versions = await db
    .select({
      revision: plannerVersionTable.revision,
      updatedAt: plannerVersionTable.createdAt,
    })
    .from(plannerVersionTable)
    .where(eq(plannerVersionTable.userId, userId))
    .orderBy(desc(plannerVersionTable.revision))
    .limit(50);

  res.json(
    ListPlannerVersionsResponse.parse(
      versions.map((version) => ({
        revision: version.revision,
        updatedAt: version.updatedAt.toISOString(),
      })),
    ),
  );
});

router.get(
  "/planner/versions/:revision",
  async (req, res): Promise<void> => {
    const params = GetPlannerVersionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [version] = await db
      .select()
      .from(plannerVersionTable)
      .where(
        and(
          eq(plannerVersionTable.userId, userIdFromResponse(res)),
          eq(plannerVersionTable.revision, params.data.revision),
        ),
      )
      .limit(1);

    if (!version) {
      res.status(404).json({ error: "Planner revision not found" });
      return;
    }

    res.json(
      GetPlannerVersionResponse.parse({
        revision: version.revision,
        updatedAt: version.createdAt.toISOString(),
        payload: version.payload,
      }),
    );
  },
);

export default router;
