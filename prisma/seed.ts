import { Prisma, PrismaClient } from "@prisma/client";
import { calculateRawMic, micRationale } from "../src/lib/mic";
import { interpretSir } from "../src/lib/rule-engine";
import { calculateBreakpointContentHash } from "../src/lib/breakpoint-lifecycle";
import type { BreakpointStandard, WellState } from "../src/types/domain";

const prisma = new PrismaClient();
const concentrations = [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
const states: WellState[] = [
  "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED",
  "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH",
];

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "dev-organization" },
    update: { name: "Development organization", active: true },
    create: { id: "dev-organization", name: "Development organization" },
  });
  const user = await prisma.user.upsert({
    where: { id: "dev-admin" },
    update: { organizationId: organization.id, role: "ADMIN", active: true, externalSubject: "dev-admin-subject" },
    create: {
      id: "dev-admin",
      organizationId: organization.id,
      externalSubject: "dev-admin-subject",
      name: "Development Admin",
      email: "dev-admin@example.invalid",
      role: "ADMIN",
    },
  });
  const sample = await prisma.sample.upsert({
    where: { organizationId_sampleCode: { organizationId: organization.id, sampleCode: "SEED-001" } },
    update: { organism: "Escherichia coli", notes: "Judgement engine and Excel export seed", createdByUserId: user.id },
    create: {
      organizationId: organization.id,
      createdByUserId: user.id,
      sampleCode: "SEED-001",
      organism: "Escherichia coli",
      notes: "Judgement engine and Excel export seed",
    },
  });
  await prisma.plate.deleteMany({ where: { sampleId: sample.id } });
  const rules = await Promise.all([
    { standard: "CLSI" as const, version: "2026.1", susceptibleMax: 2, resistantMin: 8 },
    { standard: "EUCAST" as const, version: "16.0", susceptibleMax: 1, resistantMin: 4 },
    { standard: "JANIS_COMPAT" as const, version: "2026-01", susceptibleMax: 0.5, resistantMin: 2 },
  ].map(async (rule) => {
    const existing = await prisma.breakpointSet.findFirst({
      where: { organizationId: organization.id, standard: rule.standard, version: rule.version },
      include: { rules: true },
    });
    if (existing?.status === "APPROVED") {
      const existingRule = existing.rules.find((item) => item.drugName === "Drug X");
      if (!existingRule) throw new Error(`Approved seed set ${existing.id} cannot be overwritten.`);
      return existingRule;
    }
    if (existing?.status === "RETIRED") throw new Error(`Retired seed set ${existing.id} cannot be overwritten.`);
    if (existing) throw new Error(`Draft seed set ${existing.id} already exists and will not be overwritten.`);
    const breakpointSet = await prisma.breakpointSet.create({
      data: {
        organizationId: organization.id,
        standard: rule.standard,
        version: rule.version,
        organism: "Escherichia coli",
        unit: "µg/mL",
        method: "BROTH_MICRODILUTION",
        status: "DRAFT",
        createdByUserId: user.id,
      },
    });
    const createdRule = await prisma.breakpointRule.create({
      data: {
        ...rule,
        organizationId: organization.id,
        breakpointSetId: breakpointSet.id,
        drugName: "Drug X",
        organism: "Escherichia coli",
        method: "BROTH_MICRODILUTION",
        unit: "µg/mL",
      },
    });
    const contentHash = calculateBreakpointContentHash({
      ...breakpointSet,
      rules: [{ ...createdRule, exceptionJson: createdRule.exceptionJson }],
    });
    await prisma.breakpointSet.update({
      where: { id: breakpointSet.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByUserId: user.id,
        contentHash,
        revision: { increment: 1 },
      },
    });
    return createdRule;
  }));

  const plate = await prisma.plate.create({
    data: {
      sampleId: sample.id,
      organizationId: organization.id,
      name: "SEED-001 Plate 1",
      status: "APPROVED",
      wellRevision: 1,
      resultRevision: 1,
      lastBreakpointSetId: rules[0].breakpointSetId,
      lastCalculatedAt: new Date(),
      drugs: { create: { rowIndex: 0, drugName: "Drug X", unit: "µg/mL", concentrations } },
      wells: {
        create: states.map((state, columnIndex) => ({
          rowIndex: 0,
          columnIndex,
          state,
          source: "MANUAL",
          confirmedByUserId: user.id,
          confirmedAt: new Date(),
        })),
      },
    },
    include: { drugs: true },
  });

  const raw = calculateRawMic(concentrations, states);
  const rawMic = await prisma.rawMic.create({
    data: {
      plateId: plate.id,
      plateDrugId: plate.drugs[0].id,
      value: raw.value,
      modifier: raw.modifier,
      rawMicOperator: raw.rawMicOperator,
      endpointRule: raw.rawMicOperator,
      calculationMethod: raw.method,
      calculationEngineVersion: raw.method,
      reviewRequired: raw.needsReview,
      sourceWellRevision: plate.wellRevision,
      breakpointSetId: rules[0].breakpointSetId!,
      status: "CURRENT",
      createdByUserId: user.id,
      rationaleJson: micRationale(raw) as Prisma.InputJsonValue,
    },
  });

  for (const [index, rule] of rules.entries()) {
    const sir = interpretSir(raw.value, raw.rawMicOperator, {
      id: rule.id,
      drugName: rule.drugName,
      organism: rule.organism,
      standard: rule.standard as BreakpointStandard,
      version: rule.version,
      susceptibleMax: rule.susceptibleMax,
      resistantMin: rule.resistantMin,
      unit: rule.unit,
    });
    await prisma.sirInterpretation.create({
      data: {
        rawMicId: rawMic.id,
        plateId: plate.id,
        plateDrugId: plate.drugs[0].id,
        breakpointSetId: rule.breakpointSetId!,
        breakpointRuleId: rule.id,
        category: sir.category,
        standard: sir.standard,
        ruleVersion: sir.ruleVersion,
        susceptibleMax: rule.susceptibleMax,
        resistantMin: rule.resistantMin,
        ruleEngineVersion: "sir-rule-engine-v2",
        status: index === 0 ? "CURRENT" : "SUPERSEDED",
        supersededAt: index === 0 ? null : new Date(),
        calculatedByUserId: user.id,
        rationaleJson: sir.rationale as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorLabel: "seed",
      actorId: user.id,
      action: "SEED_CREATED",
      entityType: "Plate",
      entityId: plate.id,
      afterJson: {
        sampleCode: sample.sampleCode,
        rawMic: { id: rawMic.id, value: raw.value, rawMicOperator: raw.rawMicOperator, reviewRequired: raw.needsReview, reasonCodes: raw.reasons },
        breakpointSetId: rules[0].breakpointSetId,
        breakpointStandards: rules.map((rule) => rule.standard),
      },
    },
  });
  console.log(`Seeded ${sample.sampleCode}: plate=${plate.id}, raw MIC=${raw.rawMicOperator}${raw.value}`);
}

main()
  .finally(async () => prisma.$disconnect());
