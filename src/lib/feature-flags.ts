import { isResearchPublicProduction } from "@/lib/research-public-access";

export function isImageReviewEnabled(): boolean {
  if (isResearchPublicProduction()) {
    return process.env.RESEARCH_PUBLIC_IMAGE_REVIEW_ENABLED === "true" &&
      process.env.NEXT_PUBLIC_IMAGE_REVIEW_ENABLED !== "false";
  }
  return process.env.NEXT_PUBLIC_IMAGE_REVIEW_ENABLED !== "false";
}

export function isImageUploadServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isResearchPublicProduction(env)) {
    return env.RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED === "true";
  }
  return env.IMAGE_UPLOAD_ENABLED !== "false";
}
