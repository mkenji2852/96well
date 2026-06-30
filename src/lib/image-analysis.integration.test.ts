import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { analyzePlateImage } from "./image-analysis";

describe("FastAPI image analysis adapter integration", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => closeServer?.());

  it("posts multipart image data and enforces review for low confidence", async () => {
    let receivedMultipart = false;
    const server = createServer((request, response) => {
      receivedMultipart = request.headers["content-type"]?.startsWith("multipart/form-data") ?? false;
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          service_version: "opencv-grid-v1",
          qc_score: 0.9,
          qc_flags: { blur: false, glare: false, low_exposure: false, skew: false },
          detected_wells: 96,
          confidence: 0.4,
          review_needed: false,
          wells: [{
            well_id: "A1",
            row_index: 0,
            column_index: 0,
            center: { x: 10, y: 10 },
            radius: 8,
            prediction: "growth",
            confidence: 0.4,
            review_needed: false,
            features: { mean_intensity: 120, intensity_std: 10, dark_fraction: 0.6 },
          }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address() as AddressInfo;

    const result = await analyzePlateImage(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
      baseUrl: `http://127.0.0.1:${address.port}`,
      confidenceThreshold: 0.85,
      fileName: "plate.png",
    });

    expect(receivedMultipart).toBe(true);
    expect(result.review_needed).toBe(true);
    expect(result.wells[0].review_needed).toBe(true);
  });
});

