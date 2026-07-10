import { describe, expect, it } from "vitest";
import { isImageUploadServerEnabled } from "./feature-flags";

describe("image feature flags", () => {
  it("keeps image upload enabled by default outside research-public production", () => {
    expect(isImageUploadServerEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("denies image upload by default in research-public production", () => {
    expect(isImageUploadServerEnabled({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
    } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("requires explicit server-side opt-in for research-public image upload", () => {
    expect(isImageUploadServerEnabled({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
      RESEARCH_PUBLIC_IMAGE_UPLOAD_ENABLED: "true",
    } as NodeJS.ProcessEnv)).toBe(true);
  });
});
