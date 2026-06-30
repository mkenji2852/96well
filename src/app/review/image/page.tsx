import { ImageReviewWorkspace } from "@/components/image-review-workspace";
import { isImageReviewEnabled } from "@/lib/feature-flags";

export default function ImageReviewPage() {
  return <ImageReviewWorkspace enabled={isImageReviewEnabled()} />;
}
