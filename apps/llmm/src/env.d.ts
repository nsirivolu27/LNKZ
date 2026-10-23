/** Vite resolves these at build time; TypeScript needs to be told they exist. */
declare module "*.css";
declare module "*.svg" {
  const url: string;
  export default url;
}
