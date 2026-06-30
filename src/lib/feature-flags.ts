export function isImageReviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IMAGE_REVIEW_ENABLED !== "false";
}
