// Same card for twitter:image as for og:image. Route segment config
// (`revalidate`) must be a static literal here, not a re-export.
export const revalidate = 300;
export { default, alt, contentType, size } from "./opengraph-image";
