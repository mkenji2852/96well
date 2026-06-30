import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIC Plate Recorder",
    short_name: "MIC Plate",
    description: "96穴プレート薬剤感受性試験の記録・レビュー",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f9",
    theme_color: "#17324d",
    lang: "ja",
  };
}
