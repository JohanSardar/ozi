export const measure = () => process.env.OZI_G3_BENCHMARK === "1" ? performance.now() : 0;
