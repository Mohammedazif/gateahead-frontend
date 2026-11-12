/// <reference types="vite/client" />

declare module "*.geojson" {
  const data: GeoJSON.FeatureCollection;
  export default data;
}
