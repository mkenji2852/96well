const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });
export const compareSampleCodes = (left: string, right: string) => collator.compare(left, right) || (left === right ? 0 : left < right ? -1 : 1);
export const withinSampleRange = (code: string, from: string, to: string) => compareSampleCodes(code, from) >= 0 && compareSampleCodes(code, to) <= 0;
